import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { _electron as electron, expect } from "playwright/test";
import { startVisibleBrowserFixtureSite } from "../fixtures/siteServer.ts";

const web = process.cwd();
const output = resolve(process.env.SYNARA_EVIDENCE_OUTPUT || "test-results/native-ui");
const label = process.env.SYNARA_EVIDENCE_LABEL || "candidate";
const fixturePageCss = "html, body { color-scheme: light; background: #fff; color: #111; }";
const testedHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: web,
  encoding: "utf8",
}).trim();
const home = mkdtempSync(join(tmpdir(), "synara-native-ui-"));
mkdirSync(output, { recursive: true });
const mainPath = join(home, "nativeUiMain.cjs");
const annotationPath = join(home, "annotationPreload.cjs");
const chromePath = join(home, "chromePreload.cjs");
function bundle(source, target, external = []) {
  execFileSync(
    "bun",
    [
      "build",
      source,
      "--target=node",
      "--format=cjs",
      "--outfile=" + target,
      "--external=electron",
      ...external,
    ],
    { cwd: web, stdio: "inherit" },
  );
}
bundle("e2e/evidence/nativeUiMain.ts", mainPath, [
  "--external=betterwright",
  "--banner=module.paths.unshift(" + JSON.stringify(resolve(web, "../desktop/node_modules")) + ");",
]);
bundle("../desktop/src/browserAnnotations/guestPreload.ts", annotationPath);
const hasChrome = existsSync(resolve(web, "../desktop/src/floatingBrowserChromePreload.ts"));
if (hasChrome) bundle("../desktop/src/floatingBrowserChromePreload.ts", chromePath);
const site = await startVisibleBrowserFixtureSite();
const server = await createServer({
  root: web,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  optimizeDeps: { include: ["react", "react-dom/client", "@tanstack/react-query"] },
});
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === "string") throw new Error("Missing isolated Vite listener");
const uiUrl = "http://127.0.0.1:" + address.port + "/e2e/evidence/nativeUi.html";
let app;
let hostWindowId;
const errors = [];
const images = [];
try {
  app = await electron.launch({
    executablePath: resolve(web, "../desktop/node_modules/electron/dist/electron"),
    args: [mainPath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      SYNARA_EVIDENCE_HOME: home,
      SYNARA_EVIDENCE_ANNOTATION_PRELOAD: annotationPath,
      ...(hasChrome ? { SYNARA_EVIDENCE_CHROME_PRELOAD: chromePath } : {}),
      SYNARA_EVIDENCE_UI_PRELOAD: resolve(web, "e2e/evidence/nativeUiPreload.cjs"),
      SYNARA_EVIDENCE_PAGE_URL: site.appUrl,
      SYNARA_EVIDENCE_UI_URL: uiUrl,
    },
    recordVideo: { dir: join(output, label + "-video"), size: { width: 1280, height: 900 } },
    timeout: 120000,
  });
  const observedPages = new WeakSet();
  const recordPageErrors = (page) => {
    if (observedPages.has(page)) return;
    observedPages.add(page);
    page.on("pageerror", (error) => errors.push(String(error)));
  };
  app.on("window", recordPageErrors);
  app.windows().forEach(recordPageErrors);
  // Native priming creates guest targets before the React host loads. Identify
  // the host by its exact URL and marker, never by target creation order.
  await expect
    .poll(() => app.windows().filter((page) => page.url() === uiUrl).length, {
      timeout: 120000,
    })
    .toBe(1);
  const shell = app.windows().find((page) => page.url() === uiUrl);
  await expect(shell).toHaveURL(uiUrl);
  await expect(shell.locator("[data-synara-native-ui-host]")).toBeVisible({ timeout: 120000 });
  hostWindowId = await app.evaluate(({ BrowserWindow }, url) => {
    const matches = BrowserWindow.getAllWindows().filter(
      (window) => window.webContents.getURL() === url,
    );
    if (matches.length !== 1) throw new Error("Expected one native evidence host window");
    return matches[0].id;
  }, uiUrl);
  await expect(shell.locator("[data-floating-browser-panel]")).toBeVisible({ timeout: 120000 });
  await expect
    .poll(
      async () =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some(
              (w) => w.getType() === "webview" && w.getURL().includes("/app") && !w.isLoading(),
            ),
        ),
      { timeout: 120000 },
    )
    .toBe(true);
  // The controlled fixture page has a transparent default background. Give
  // that synthetic content the same readable colors on both source revisions;
  // no production host, browser chrome or component styles are changed.
  await app.evaluate(
    async ({ webContents }, { url, css }) => {
      const guests = webContents
        .getAllWebContents()
        .filter((guest) => guest.getType() === "webview" && guest.getURL() === url);
      if (guests.length !== 1) throw new Error("Expected one loaded synthetic fixture page");
      await guests[0].insertCSS(css);
    },
    { url: site.appUrl, css: fixturePageCss },
  );
  await shell.evaluate(() => document.fonts.ready);
  await shell.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  async function capture(name) {
    const png = await app.evaluate(async ({ BrowserWindow }, id) => {
      const host = BrowserWindow.fromId(id);
      if (!host) throw new Error("Native evidence host window was closed");
      return (await host.capturePage()).toPNG().toString("base64");
    }, hostWindowId);
    const path = join(output, label + "-" + name + ".png");
    writeFileSync(path, Buffer.from(png, "base64"));
    images.push(path);
  }
  await capture("floating");
  const nativeChrome = await app.evaluate(
    ({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getType() === "webview" && w.getURL().startsWith("data:text/html"))?.id ??
      null,
  );
  if (nativeChrome !== null) {
    async function clickChrome(selector) {
      await expect
        .poll(
          async () =>
            app.evaluate(
              async ({ webContents }, { id, selector }) => {
                const guest = webContents.fromId(id);
                return guest.executeJavaScript(
                  "(() => { const e=document.querySelector(" +
                    JSON.stringify(selector) +
                    "); if(!e) return false; const r=e.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === e || e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()",
                );
              },
              { id: nativeChrome, selector },
            ),
          { timeout: 10000 },
        )
        .toBe(true);
      const point = await app.evaluate(
        async ({ webContents }, { id, selector }) => {
          const guest = webContents.fromId(id);
          const point = await guest.executeJavaScript(
            "(() => { const r=document.querySelector(" +
              JSON.stringify(selector) +
              ").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()",
          );
          guest.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
          if (selector !== "#drag")
            guest.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
          return point;
        },
        { id: nativeChrome, selector },
      );
      if (selector === "#drag") {
        // Native pointerdown installs the production React gesture overlay.
        // The release now belongs to the host surface, just as real hit testing
        // routes the user's release after that overlay covers the native guest.
        await expect(shell.locator("body > [data-panel-resize-overlay]")).toBeVisible();
        const hostPoint = await shell.evaluate((point) => {
          const rect = document
            .querySelector("[data-floating-browser-chrome-thread]")
            .getBoundingClientRect();
          return { x: Math.round(rect.x + point.x), y: Math.round(rect.y + point.y) };
        }, point);
        await app.evaluate(
          ({ BrowserWindow }, { id, point }) => {
            const host = BrowserWindow.fromId(id);
            if (!host) throw new Error("Native evidence host window was closed");
            host.webContents.sendInputEvent({
              type: "mouseUp",
              button: "left",
              clickCount: 1,
              ...point,
            });
          },
          { id: hostWindowId, point: hostPoint },
        );
        await expect(shell.locator("body > [data-panel-resize-overlay]")).toHaveCount(0);
      }
    }
    await clickChrome("#drag");
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, id) =>
            webContents
              .fromId(id)
              .executeJavaScript("document.querySelector('#drag').getAttribute('aria-expanded')"),
          nativeChrome,
        ),
      )
      .toBe("true");
    await capture("controls");
    await clickChrome("#pop");
  } else {
    await shell.getByRole("button", { name: "Floating browser actions", exact: true }).click();
    await expect(
      shell.getByRole("button", { name: "Open browser in sidebar", exact: true }),
    ).toBeVisible();
    await capture("controls");
    await shell.getByRole("button", { name: "Open browser in sidebar", exact: true }).click();
  }
  await expect
    .poll(() => shell.evaluate(() => window.__synaraNativeUiMode), { timeout: 10000 })
    .toBe("sidebar");
  await expect(shell.locator("aside")).toBeVisible();
  await shell.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await capture("sidebar");
  expect(errors).toEqual([]);
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  writeFileSync(
    join(output, label + "-metadata.json"),
    JSON.stringify(
      {
        testedHead,
        label,
        hostUrl: uiUrl,
        hostWindowId,
        fixturePageCss,
        images,
        errors,
        boundary:
          "Production React FloatingBrowserPanel/BrowserPanel and DesktopBrowserManager in isolated native Electron fixture",
      },
      null,
      2,
    ),
  );
  await app?.close();
  await server.close();
  await site.close();
  rmSync(home, { recursive: true, force: true });
}
