import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createServer } from "vite";
import { _electron as electron, expect } from "playwright/test";
import { createBrowserMcpHarness } from "../fixtures/mcpBrowserHarness.ts";
import { startNativeStackSite } from "./nativeStackSite.mjs";

const web = process.cwd();
const output = resolve(process.env.SYNARA_NATIVE_STACK_OUTPUT || "test-results/native-stack");
const label = process.env.SYNARA_NATIVE_STACK_LABEL;
const scenario = process.env.SYNARA_NATIVE_STACK_SCENARIO;
const variant = process.env.SYNARA_NATIVE_STACK_VARIANT;
if (
  !/^pr\d+-(before|after)$/.test(label || "") ||
  !["retention", "parallel", "restart"].includes(scenario) ||
  !["before", "after"].includes(variant)
) {
  throw new Error("Expected an explicit reviewed native-stack target");
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: web, encoding: "utf8" }).trim();
const source = git("rev-parse", "HEAD");
const home = mkdtempSync(join(tmpdir(), "synara-native-stack-"));
const mainPath = join(home, "nativeStackMain.cjs");
const annotationPath = join(home, "annotationPreload.cjs");
const threadId = "native-stack-evidence";
const statePath = join(home, "browser-workspaces.json");
const errors = [];
const observations = [];
const images = [];
const launches = [];
const commands = [];
let active;
let site;
let server;
mkdirSync(output, { recursive: true });

function bundle(sourcePath, target, external = []) {
  const args = [
    "build",
    sourcePath,
    "--target=node",
    "--format=cjs",
    "--outfile=" + target,
    "--external=electron",
    ...external,
  ];
  commands.push({ executable: "bun", args });
  execFileSync("bun", args, { cwd: web, stdio: "inherit", timeout: 60000 });
}
function deadline(promise, milliseconds, context) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${context} exceeded ${milliseconds}ms`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
async function close(launch, gracefulRequired = false) {
  if (!launch || launch.closed) return;
  const child = launch.app.process();
  let failure;
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve));
  const closing = launch.app.close().catch((error) => {
    failure = error;
  });
  let forced = false;
  try {
    await deadline(
      Promise.all([closing, exited]),
      5000,
      "Electron graceful close and process exit",
    );
  } catch (error) {
    forced = true;
    failure = error;
    child.kill("SIGKILL");
    await deadline(Promise.all([closing, exited]), 2000, "Electron forced cleanup");
  } finally {
    launch.metadata.exit = {
      forced,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      error: failure ? String(failure) : null,
    };
  }
  launch.closed = true;
  if (gracefulRequired) {
    expect(forced).toBe(false);
    expect(failure).toBeUndefined();
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
  } else if (failure) {
    throw failure;
  }
}
async function launch(phase) {
  const capability = randomUUID();
  const pipePath = join(home, `browser-${phase}.sock`);
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing isolated Vite listener");
  const uiUrl = `http://127.0.0.1:${address.port}/e2e/nativeStack/nativeStack.html`;
  const metadata = { phase, hostUrl: uiUrl };
  launches.push(metadata);
  const response = await fetch(uiUrl, { signal: AbortSignal.timeout(15000) });
  const hostHtml = await response.text();
  metadata.http = { status: response.status, htmlSha256: sha256(hostHtml) };
  expect(response.ok).toBe(true);
  expect(hostHtml).toContain('src="./nativeStack.tsx"');
  const app = await electron.launch({
    executablePath: resolve(web, "../desktop/node_modules/electron/dist/electron"),
    args: [mainPath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      SYNARA_HOME: home,
      SYNARA_NATIVE_STACK_HOME: home,
      SYNARA_NATIVE_STACK_ANNOTATION_PRELOAD: annotationPath,
      SYNARA_NATIVE_STACK_UI_PRELOAD: resolve(web, "e2e/nativeStack/nativeStackPreload.cjs"),
      SYNARA_NATIVE_STACK_UI_URL: uiUrl,
      SYNARA_BROWSER_HOST_PIPE_PATH: pipePath,
      SYNARA_BROWSER_HOST_CAPABILITY: capability,
    },
    recordVideo: {
      dir: join(output, `${label}-${phase}-video`),
      size: { width: 1280, height: 900 },
    },
    timeout: 120000,
  });
  metadata.pid = app.process().pid;
  const current = { app, metadata, closed: false };
  active = current;
  const observed = new WeakSet();
  const observe = (page) => {
    if (observed.has(page)) return;
    observed.add(page);
    page.on("pageerror", (error) => errors.push(`${phase}: ${error}`));
  };
  app.on("window", observe);
  app.windows().forEach(observe);
  let stderr = "";
  app.process().stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-200000);
  });
  app
    .process()
    .once("exit", () => writeFileSync(join(output, `${label}-${phase}-electron.log`), stderr));
  metadata.startup = await app.evaluate(({ app, BrowserWindow, webContents }) => ({
    ready: app.isReady(),
    managerRegistered: Boolean(globalThis.__synaraNativeStackEvidence),
    windows: BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      url: window.webContents.getURL(),
      loading: window.webContents.isLoading(),
    })),
    contents: webContents.getAllWebContents().map((contents) => ({
      id: contents.id,
      type: contents.getType(),
      url: contents.getURL(),
    })),
  }));
  console.log(JSON.stringify({ nativeStartup: metadata }));
  await expect
    .poll(() => app.windows().filter((page) => page.url() === uiUrl).length, { timeout: 120000 })
    .toBe(1);
  const shell = app.windows().find((page) => page.url() === uiUrl);
  await expect(shell).toHaveURL(uiUrl);
  await expect(shell.locator("[data-synara-native-stack-host]")).toBeVisible({ timeout: 120000 });
  const hostWindowId = await app.evaluate(({ BrowserWindow }, url) => {
    const hosts = BrowserWindow.getAllWindows().filter(
      (window) => window.webContents.getURL() === url,
    );
    if (hosts.length !== 1) throw new Error("Expected one exact native-stack host");
    return hosts[0].id;
  }, uiUrl);
  metadata.hostWindowId = hostWindowId;
  metadata.electronVersion = await app.evaluate(() => process.versions.electron);
  await expect
    .poll(() => app.evaluate(() => globalThis.__synaraNativeStackPipeReady), { timeout: 10000 })
    .toBe(true);
  return Object.assign(current, {
    shell,
    hostWindowId,
    mcp: createBrowserMcpHarness({ pipePath, capability, threadId, workspaceRoot: home }),
  });
}
async function snapshot(current) {
  return current.app.evaluate(() => {
    const { manager, threadId } = globalThis.__synaraNativeStackEvidence;
    return {
      state: manager.getState({ threadId }),
      runtimes: [...manager.runtimes.values()].map((runtime) => ({
        tabId: runtime.tabId,
        id: runtime.webContents.id,
        destroyed: runtime.webContents.isDestroyed(),
        native: runtime.ownsWebContents,
      })),
      automationKeys: [...manager.automationRuntimeKeys],
      attachedRuntimeKey: manager.attachedRuntimeKey,
    };
  });
}
async function pageEval(current, tabId, code) {
  return current.app.evaluate(
    async (_, input) => {
      const { manager, threadId } = globalThis.__synaraNativeStackEvidence;
      const runtime = manager.runtimes.get(`${threadId}:${input.tabId}`);
      if (!runtime || runtime.webContents.isDestroyed() || !runtime.ownsWebContents) {
        throw new Error("Expected an existing real native runtime; inspection does not create one");
      }
      return {
        webContentsId: runtime.webContents.id,
        value: await runtime.webContents.executeJavaScript(input.code),
      };
    },
    { tabId, code },
  );
}
async function loaded(current, tabId, url) {
  await expect
    .poll(
      () =>
        current.app.evaluate(
          (_, input) => {
            const { manager, threadId } = globalThis.__synaraNativeStackEvidence;
            const runtime = manager.runtimes.get(`${threadId}:${input.tabId}`);
            return Boolean(
              runtime &&
              runtime.ownsWebContents &&
              !runtime.webContents.isDestroyed() &&
              !runtime.webContents.isLoading() &&
              runtime.webContents.getURL().split("#")[0] === input.url,
            );
          },
          { tabId, url },
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(async () => (await pageEval(current, tabId, "document.readyState")).value, {
      timeout: 10000,
    })
    .toBe("complete");
  const title = (await pageEval(current, tabId, "document.title")).value;
  await expect
    .poll(
      async () => {
        const tab = (await snapshot(current)).state.tabs.find((item) => item.id === tabId);
        return tab?.title === title && tab.lastCommittedUrl?.split("#")[0] === url;
      },
      { timeout: 10000 },
    )
    .toBe(true);
}
async function show(current) {
  await current.shell.getByRole("button", { name: "Show browser", exact: true }).click();
  await expect(current.shell.locator("[data-browser-panel='true']")).toBeVisible({
    timeout: 10000,
  });
}
async function navigate(current, url) {
  const input = current.shell.getByPlaceholder("Search or enter a URL", { exact: true });
  await input.fill(url);
  await input.press("Enter");
  await expect
    .poll(
      async () => {
        const { state } = await snapshot(current);
        return state.tabs.find((tab) => tab.id === state.activeTabId)?.url;
      },
      { timeout: 10000 },
    )
    .toBe(url);
  const { state } = await snapshot(current);
  await loaded(current, state.activeTabId, url);
  return state.activeTabId;
}
async function newTab(current, label) {
  const before = (await snapshot(current)).state.tabs.length;
  await current.shell.getByRole("button", { name: "New tab", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(current)).state.tabs.length, { timeout: 10000 })
    .toBe(before + 1);
  const state = (await snapshot(current)).state;
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  await expect(
    current.shell.locator('[data-browser-tab-active="true"] button[title]'),
  ).toHaveAttribute("title", active.title, { timeout: 10000 });
  return navigate(current, site.page(label));
}
async function select(current, label, tabId) {
  await current.shell.getByTitle(`${label} workspace`, { exact: true }).click();
  await expect
    .poll(async () => (await snapshot(current)).state.activeTabId, { timeout: 10000 })
    .toBe(tabId);
  await expect(
    current.shell.locator('[data-browser-tab-active="true"] button[title]'),
  ).toHaveAttribute("title", `${label} workspace`, { timeout: 10000 });
  await loaded(current, tabId, site.page(label));
}
async function typeDraft(current, tabId, value) {
  await current.app.evaluate(
    async (_, input) => {
      const { manager, threadId } = globalThis.__synaraNativeStackEvidence;
      const runtime = manager.runtimes.get(`${threadId}:${input.tabId}`);
      if (!runtime?.ownsWebContents) throw new Error("Native input target is missing");
      const guest = runtime.webContents;
      const point = await guest.executeJavaScript(
        "(() => { const e=document.querySelector('#draft'); const r=e.getBoundingClientRect(); const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2); if(document.elementFromPoint(x,y)!==e) throw new Error('Draft field is not hit-testable'); return {x,y}; })()",
      );
      guest.focus();
      guest.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      guest.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await guest.insertText(input.value);
    },
    { tabId, value },
  );
  await expect
    .poll(
      async () => (await pageEval(current, tabId, "document.querySelector('#draft').value")).value,
      { timeout: 10000 },
    )
    .toBe(value);
}
const sampleCode =
  "({ label:window.__stackLabel, nonce:window.__stackNonce, draft:document.querySelector('#draft').value, scrollY:Math.round(scrollY), historyLength:history.length, historyState:history.state, url:location.href, operations:window.__stackOperations })";
async function sample(current, tabId) {
  return pageEval(current, tabId, sampleCode);
}
async function capture(current, name) {
  const state = await snapshot(current);
  const activeTab = state.state.tabs.find((tab) => tab.id === state.state.activeTabId);
  let page = null;
  if (activeTab?.url.startsWith(site.page("").split("?")[0])) {
    await loaded(current, activeTab.id, activeTab.url.split("#")[0]);
    const colors = await pageEval(
      current,
      activeTab.id,
      "document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color})))) )",
    );
    expect(colors.value).toEqual({ background: "rgb(255, 255, 255)", color: "rgb(17, 17, 17)" });
    page = await sample(current, activeTab.id);
  }
  await current.shell.evaluate(() => document.fonts.ready);
  await current.shell.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const png = await current.app.evaluate(async ({ BrowserWindow }, id) => {
    const host = BrowserWindow.fromId(id);
    if (!host) throw new Error("Native-stack host was closed");
    return (await host.capturePage()).toPNG().toString("base64");
  }, current.hostWindowId);
  const nameWithLabel = `${label}-${name}.png`;
  const bytes = Buffer.from(png, "base64");
  writeFileSync(join(output, nameWithLabel), bytes);
  images.push({ name: nameWithLabel, bytes: bytes.length, sha256: sha256(bytes), state, page });
}
async function retention(current) {
  await show(current);
  const a = await navigate(current, site.page("A"));
  async function seed(tabId, label) {
    await typeDraft(current, tabId, `${label} draft retained in memory`);
    await pageEval(
      current,
      tabId,
      `history.pushState({nativeStack:${JSON.stringify(label)}},'',${JSON.stringify("#kept-" + label)}); scrollTo(0,480); true;`,
    );
    await expect
      .poll(async () => (await sample(current, tabId)).value.scrollY, { timeout: 10000 })
      .toBe(480);
    return sample(current, tabId);
  }
  const originalA = await seed(a, "A");
  const b = await newTab(current, "B");
  const originalB = await seed(b, "B");
  await newTab(current, "C");
  const started = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const elapsed = performance.now() - started;
  await select(current, "A", a);
  const returnedA = await sample(current, a);
  await select(current, "B", b);
  const returnedB = await sample(current, b);
  await select(current, "A", a);
  const finalA = await sample(current, a);
  const inspection = await snapshot(current);
  expect(inspection.automationKeys).toEqual([]);
  const retained =
    isDeepStrictEqual(originalA, returnedA) &&
    isDeepStrictEqual(originalB, returnedB) &&
    isDeepStrictEqual(originalA, finalA);
  observations.push({
    contract: "ordinary unclaimed native tab retention",
    originalA,
    originalB,
    returnedA,
    returnedB,
    finalA,
    elapsedMilliseconds: elapsed,
    retained,
    inspection,
  });
  if (variant === "after") {
    expect(returnedA).toEqual(originalA);
    expect(returnedB).toEqual(originalB);
    expect(finalA).toEqual(originalA);
  } else {
    expect(retained).toBe(false);
  }
  await capture(current, "returned-A");
  await select(current, "B", b);
  await capture(current, "returned-B");
}
async function parallel(current) {
  await current.mcp.initialize();
  const open = await current.mcp.call("browser_open", {
    url: site.page("Agent"),
    show: true,
    reuse: true,
  });
  const agentTabId = String(open.structuredContent.tabId);
  await expect(current.shell.locator("[data-browser-panel='true']")).toBeVisible({
    timeout: 10000,
  });
  await loaded(current, agentTabId, site.page("Agent"));
  const originalAgent = await sample(current, agentTabId);
  const run = (code, tabId) =>
    current.mcp.call("browser_run", {
      code,
      timeoutMs: 30000,
      idempotencyKey: randomUUID(),
      ...(tabId ? { tabId } : {}),
    });
  for (const kind of ["ordinary", "oauth"]) {
    const agentBefore = await sample(current, agentTabId);
    const gate = site.createGate();
    const popupPrefix =
      kind === "oauth"
        ? 'await human.click(page.getByRole("button", {name:"Open synthetic OAuth popup",exact:true})); '
        : "";
    const code =
      popupPrefix +
      `return await page.evaluate(async (gateUrl) => {const response=await fetch(gateUrl); if(!response.ok) throw new Error('Unreleased fixture gate'); window.__stackOperations++; document.querySelector('#operations').textContent='Agent operations: '+window.__stackOperations; return {label:window.__stackLabel,nonce:window.__stackNonce,operations:window.__stackOperations};},${JSON.stringify(gate.url)});`;
    const settling = run(code, agentTabId).then(
      (result) => ({ result }),
      (error) => ({ error: String(error) }),
    );
    try {
      await expect.poll(gate.requested, { timeout: 10000 }).toBe(true);
      const humanLabel = kind === "oauth" ? "HumanOAuth" : "Human";
      const humanTabId = await newTab(current, humanLabel);
      await typeDraft(current, humanTabId, `${humanLabel} draft remains mine`);
      const humanBefore = await sample(current, humanTabId);
      gate.release();
      const outcome = await deadline(settling, 30000, `${kind} browser_run settlement`);
      const status = (await current.mcp.call("browser_status")).structuredContent;
      const visible = await snapshot(current);
      const humanAfter = await sample(current, humanTabId);
      observations.push({
        contract: `${kind} human new-tab race`,
        agentTabId,
        agentBefore,
        humanTabId,
        outcome,
        status,
        visible,
        humanBefore,
        humanAfter,
      });
      expect(visible.state.activeTabId).toBe(humanTabId);
      expect(humanAfter).toEqual(humanBefore);
      if (variant === "after") {
        expect(outcome.error).toBeUndefined();
        expect(outcome.result.structuredContent.tabId).toBe(agentTabId);
        expect(outcome.result.structuredContent.openedTabId).toBeUndefined();
        expect(outcome.result.structuredContent.value).toMatchObject({
          label: "Agent",
          nonce: originalAgent.value.nonce,
          operations: agentBefore.value.operations + 1,
        });
        expect((await sample(current, agentTabId)).value.operations).toBe(
          agentBefore.value.operations + 1,
        );
        expect(status.assignedTabId).toBe(agentTabId);
        const followUp = await run(
          "return await page.evaluate(() => {window.__stackOperations++; document.querySelector('#operations').textContent='Agent operations: '+window.__stackOperations; return {label:window.__stackLabel,nonce:window.__stackNonce,operations:window.__stackOperations};});",
        );
        expect(followUp.structuredContent.tabId).toBe(agentTabId);
        expect(followUp.structuredContent.value).toMatchObject({
          label: "Agent",
          nonce: originalAgent.value.nonce,
          operations: agentBefore.value.operations + 2,
        });
        expect((await sample(current, agentTabId)).value.operations).toBe(
          agentBefore.value.operations + 2,
        );
        expect((await snapshot(current)).state.activeTabId).toBe(humanTabId);
        expect(await sample(current, humanTabId)).toEqual(humanBefore);
        observations.push({
          contract: `${kind} follow-up agent affinity`,
          result: followUp.structuredContent,
        });
      } else {
        expect(outcome.error).toMatch(/BrowserInterruptedByHuman/);
      }
      await capture(current, `${kind}-human-page`);
    } finally {
      gate.release();
      await deadline(settling, 30000, `${kind} browser_run cleanup`);
    }
  }
  const popup = await run(
    'await human.click(page.getByRole("link", {name:"Open correlated tab",exact:true})); return true;',
    agentTabId,
  );
  const popupTabId = popup.structuredContent.openedTabId;
  expect(typeof popupTabId).toBe("string");
  expect(popupTabId).not.toBe(agentTabId);
  await loaded(current, popupTabId, site.page("Popup"));
  const popupStatus = (await current.mcp.call("browser_status")).structuredContent;
  expect(popupStatus.assignedTabId).toBe(popupTabId);
  expect((await snapshot(current)).state.tabs.some((tab) => tab.id === popupTabId)).toBe(true);
  observations.push({
    contract: "explicitly correlated popup adoption",
    result: popup.structuredContent,
    status: popupStatus,
    page: await sample(current, popupTabId),
  });
  await select(current, "Popup", popupTabId);
  await capture(current, "correlated-popup");
}
async function restart(first) {
  await show(first);
  const a = await navigate(first, site.page("A"));
  await typeDraft(first, a, "Transient draft must not be persisted");
  const b = await newTab(first, "B");
  await select(first, "A", a);
  const before = await snapshot(first);
  expect(before.state.tabs.map((tab) => tab.id)).toEqual([a, b]);
  expect(before.state.activeTabId).toBe(a);
  await capture(first, "before-shutdown");
  await first.shell.getByRole("button", { name: "Hide browser", exact: true }).click();
  await expect(first.shell.locator("[data-browser-panel='true']")).toHaveCount(0);
  await expect
    .poll(async () => (await snapshot(first)).attachedRuntimeKey, { timeout: 10000 })
    .toBeNull();
  const hidden = await snapshot(first);
  expect(hidden.state.tabs.map((tab) => tab.id)).toEqual([a, b]);
  await close(first, true);
  const file = existsSync(statePath) ? readFileSync(statePath) : null;
  if (file) writeFileSync(join(output, `${label}-workspace-state.json`), file);
  if (variant === "after") expect(file).not.toBeNull();
  else expect(file).toBeNull();
  const second = await launch("restart");
  const restored = await snapshot(second);
  expect(restored.runtimes).toEqual([]);
  expect(restored.automationKeys).toEqual([]);
  if (variant === "after") {
    expect(
      restored.state.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title })),
    ).toEqual(
      before.state.tabs.map((tab) => ({ id: tab.id, url: tab.lastCommittedUrl, title: tab.title })),
    );
    expect(restored.state.activeTabId).toBe(a);
    expect(
      restored.state.tabs.every(
        (tab) => tab.status === "suspended" && tab.runtimeSurface === "native",
      ),
    ).toBe(true);
  } else {
    expect(restored.state.tabs).toEqual([]);
    expect(restored.state.activeTabId).toBeNull();
  }
  observations.push({
    contract: "actual process restart before reveal",
    before,
    hidden,
    restored,
    stateFile: file ? { bytes: file.length, sha256: sha256(file) } : null,
  });
  await show(second);
  if (variant === "after") {
    await loaded(second, a, site.page("A"));
    const revealed = await snapshot(second);
    expect(revealed.runtimes.map((runtime) => runtime.tabId)).toEqual([a]);
    expect(revealed.automationKeys).toEqual([]);
    expect((await sample(second, a)).value.draft).toBe("");
    await capture(second, "restored-active-A");
    await select(second, "B", b);
    expect((await snapshot(second)).runtimes.map((runtime) => runtime.tabId).toSorted()).toEqual(
      [a, b].toSorted(),
    );
    expect((await sample(second, b)).value.draft).toBe("");
    await capture(second, "lazy-B");
  } else {
    const fresh = await snapshot(second);
    expect(fresh.state.tabs).toHaveLength(1);
    expect(fresh.state.tabs[0].id).not.toBe(a);
    expect(fresh.state.tabs[0].id).not.toBe(b);
    await capture(second, "fresh-workspace");
  }
  await close(second, true);
}
try {
  bundle("e2e/nativeStack/nativeStackMain.ts", mainPath, [
    "--external=betterwright",
    "--banner=process.on('uncaughtException',error=>{console.error(error);process.exit(1)});process.on('unhandledRejection',error=>{console.error(error);process.exit(1)});module.paths.unshift(" +
      JSON.stringify(resolve(web, "../desktop/node_modules")) +
      ");",
  ]);
  bundle("../desktop/src/browserAnnotations/guestPreload.ts", annotationPath);
  site = await startNativeStackSite();
  server = await createServer({
    root: web,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    optimizeDeps: { include: ["react", "react-dom/client", "@tanstack/react-query"] },
  });
  await server.listen();
  const first = await launch("first");
  if (scenario === "retention")
    await deadline(retention(first), 120000, "Native retention scenario");
  if (scenario === "parallel") await deadline(parallel(first), 180000, "Native parallel scenario");
  if (scenario === "restart") await deadline(restart(first), 240000, "Native restart scenario");
  expect(errors).toEqual([]);
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  try {
    await close(active, true);
  } catch (error) {
    errors.push(`Cleanup: ${error}`);
    process.exitCode = 1;
  }
  for (const [context, cleanup] of [
    ["Vite cleanup", () => server?.close()],
    ["Fixture-site cleanup", () => site?.close()],
  ]) {
    try {
      await deadline(Promise.resolve(cleanup()), 5000, context);
    } catch (error) {
      errors.push(`Cleanup: ${error}`);
      process.exitCode = 1;
    }
  }
  writeFileSync(
    join(output, `${label}-metadata.json`),
    JSON.stringify(
      {
        source,
        sourceTree: git("rev-parse", "HEAD^{tree}"),
        lockfileSha256: sha256(readFileSync(resolve(web, "../../bun.lock"))),
        label,
        scenario,
        variant,
        launches,
        commands,
        observations,
        images,
        errors,
        boundary:
          "Unmodified production React BrowserPanel, DesktopBrowserManager and MCP browser tool transport in an isolated Electron fixture; synthetic loopback pages and empty local-server discovery; no provider account or full-app claim",
      },
      null,
      2,
    ) + "\n",
  );
  rmSync(home, { recursive: true, force: true });
}

