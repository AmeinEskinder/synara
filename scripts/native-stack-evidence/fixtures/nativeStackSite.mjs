import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export async function startNativeStackSite() {
  const gates = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const gate = gates.get(url.pathname);
    if (gate) {
      gate.requested = true;
      gate.response = response;
      gate.timer = setTimeout(() => {
        response.writeHead(504).end("Fixture gate was not released within 30 seconds");
      }, 30000);
      response.once("close", () => clearTimeout(gate.timer));
      if (gate.released) gate.release();
      return;
    }
    if (url.pathname !== "/page") {
      response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404).end();
      return;
    }
    const label = url.searchParams.get("tab");
    if (!label || !/^[A-Z][A-Za-z0-9-]{0,24}$/.test(label)) {
      response.writeHead(400).end("Invalid synthetic tab label");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>${label} workspace</title>
      <style>html,body{color-scheme:light;background:#fff;color:#111}body{margin:0;min-height:2200px;font:18px system-ui,sans-serif}main{position:sticky;top:0;background:#fff;border-bottom:1px solid #bbb;padding:32px}label{display:block;margin:20px 0}input{display:block;width:440px;padding:10px;font:inherit;background:#fff;color:#111;border:1px solid #555}button,a{display:inline-block;margin:12px 16px 12px 0;padding:10px}footer{position:absolute;top:2000px;padding:32px}</style>
      </head><body><main><h1>${label} workspace</h1><p>Isolated synthetic page for native browser acceptance.</p>
      <label>Workspace draft<input id="draft" aria-label="Workspace draft" autocomplete="off"></label>
      <p id="operations">Agent operations: 0</p>
      <a id="popup" href="/page?tab=Popup" target="_blank">Open correlated tab</a>
      <button id="oauth" type="button">Open synthetic OAuth popup</button>
      <p id="position">Scroll: 0</p></main><footer>Lower document marker</footer>
      <script>window.__stackNonce=crypto.randomUUID();window.__stackOperations=0;window.__stackLabel=${JSON.stringify(label)};
      window.addEventListener('scroll',()=>document.querySelector('#position').textContent='Scroll: '+Math.round(scrollY));
      document.querySelector('#oauth').onclick=()=>window.open('/page?tab=OAuth','native-stack-auth','width=480,height=640');
      </script></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing isolated native-stack listener");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    page(label) {
      return `${origin}/page?tab=${label}`;
    },
    createGate() {
      const path = `/gate/${randomUUID()}`;
      const gate = {
        requested: false,
        released: false,
        response: undefined,
        timer: undefined,
        release() {
          gate.released = true;
          if (gate.response && !gate.response.writableEnded) {
            clearTimeout(gate.timer);
            gate.response
              .writeHead(200, { "content-type": "application/json" })
              .end('{"released":true}');
          }
        },
      };
      gates.set(path, gate);
      return { url: `${origin}${path}`, requested: () => gate.requested, release: gate.release };
    },
    async close() {
      for (const gate of gates.values()) gate.release();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
