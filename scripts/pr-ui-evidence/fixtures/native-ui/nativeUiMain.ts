import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { ThreadId } from "@synara/contracts";
import {
  BROWSER_SESSION_PARTITION,
  DesktopBrowserManager,
} from "../../../desktop/src/browserManager";
import { hardenBrowserAnnotationWebviewPreferences } from "../../../desktop/src/browserAnnotations/webviewSecurity";
import { BROWSER_IPC_CHANNELS } from "../../../desktop/src/ipcChannels";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("Missing isolated native evidence environment: " + name);
  return value;
};
const threadId = ThreadId.makeUnsafe("native-ui-evidence");
app.setPath("userData", join(required("SYNARA_EVIDENCE_HOME"), "electron-userdata"));
const manager = new DesktopBrowserManager({
  annotationPreloadPath: required("SYNARA_EVIDENCE_ANNOTATION_PRELOAD"),
});
let window: BrowserWindow;
const methods = new Set([
  "getState",
  "open",
  "close",
  "hide",
  "setPanelBounds",
  "attachWebview",
  "detachWebview",
  "navigate",
  "reload",
  "goBack",
  "goForward",
  "newTab",
  "closeTab",
  "selectTab",
  "copyLink",
  "captureScreenshot",
  "copyScreenshotToClipboard",
  "openDevTools",
]);
ipcMain.handle("synara-evidence:browser", (event, method: string, input: unknown) => {
  if (!window || event.sender.id !== window.webContents.id || !methods.has(method))
    throw new Error("Unexpected evidence IPC");
  const payload = input as { threadId?: ThreadId };
  if (payload.threadId !== threadId) throw new Error("Unexpected evidence thread");
  if (method === "attachWebview") return manager.attachWebview(input as never, event.sender.id);
  return (manager[method as keyof DesktopBrowserManager] as (value: never) => unknown).call(
    manager,
    input as never,
  );
});
ipcMain.on(BROWSER_IPC_CHANNELS.webMcpCompatibilityPolicy, (event) => {
  event.returnValue = manager.isWebMcpCompatibilityAllowed(event.sender.id);
});
ipcMain.on(BROWSER_IPC_CHANNELS.annotations.guestMessage, (event, payload: unknown) => {
  if (event.senderFrame === event.sender.mainFrame)
    manager.handleAnnotationGuestMessage(event.sender, payload);
});
manager.subscribe((state) => {
  if (window && !window.isDestroyed()) window.webContents.send("synara-evidence:state", state);
});
manager.subscribeCopyLink((event) => {
  if (window && !window.isDestroyed()) window.webContents.send("synara-evidence:copy-link", event);
});
Object.assign(globalThis, { __synaraNativeUIEvidence: { manager, threadId } });

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    useContentSize: true,
    show: true,
    webPreferences: {
      preload: required("SYNARA_EVIDENCE_UI_PRELOAD"),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  manager.setWindow(window);
  window.webContents.on("will-attach-webview", (event, preferences, params) => {
    const chrome = params.partition === "synara-floating-browser-chrome";
    const preloadPath = chrome
      ? process.env.SYNARA_EVIDENCE_CHROME_PRELOAD
      : process.env.SYNARA_EVIDENCE_ANNOTATION_PRELOAD;
    if (
      !preloadPath ||
      !hardenBrowserAnnotationWebviewPreferences({
        partition: params.partition,
        expectedPartition: chrome ? "synara-floating-browser-chrome" : BROWSER_SESSION_PARTITION,
        preloadPath,
        webPreferences: preferences,
      })
    )
      event.preventDefault();
  });
  manager.open({ threadId, initialUrl: required("SYNARA_EVIDENCE_PAGE_URL") });
  // This is the established native-to-renderer priming path from the real E2E
  // fixture. Production React then owns all page layout and lifetime behavior.
  const bounds = { x: 0, y: 60, width: 800, height: 600 };
  manager.setPanelBounds({ threadId, surface: "native", bounds });
  manager.setPanelBounds({ threadId, surface: "renderer", bounds });
  await window.loadURL(required("SYNARA_EVIDENCE_UI_URL"));
});
app.on("before-quit", () => manager.dispose());
