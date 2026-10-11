import { join } from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { ThreadId } from "@synara/contracts";
import {
  BROWSER_SESSION_PARTITION,
  DesktopBrowserManager,
} from "../../../desktop/src/browserManager";
import { BrowserUsePipeServer } from "../../../desktop/src/browserUsePipeServer";
import { hardenBrowserAnnotationWebviewPreferences } from "../../../desktop/src/browserAnnotations/webviewSecurity";
import { isClipboardWritePermission } from "../../../desktop/src/clipboardPermissions";
import { BROWSER_IPC_CHANNELS } from "../../../desktop/src/ipcChannels";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing isolated native-stack environment: ${name}`);
  return value;
};
const threadId = ThreadId.makeUnsafe("native-stack-evidence");
const home = required("SYNARA_NATIVE_STACK_HOME");
app.setPath("userData", join(home, "electron-userdata"));
// The earlier pinned source ignores this additional constructor option. The
// restore source uses the same production state-file injection as desktop/main.
const managerOptions = {
  annotationPreloadPath: required("SYNARA_NATIVE_STACK_ANNOTATION_PRELOAD"),
  workspaceStatePath: join(home, "browser-workspaces.json"),
};
const manager = new DesktopBrowserManager(managerOptions);
let host: BrowserWindow | undefined;
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
ipcMain.handle("synara-stack:browser", (event, method: string, input: unknown) => {
  if (!host || event.sender.id !== host.webContents.id || !methods.has(method)) {
    throw new Error("Unexpected native-stack browser IPC");
  }
  if (
    !input ||
    typeof input !== "object" ||
    (input as { threadId?: string }).threadId !== threadId
  ) {
    throw new Error("Unexpected native-stack thread scope");
  }
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
  if (event.senderFrame && event.senderFrame === event.sender.mainFrame) {
    manager.handleAnnotationGuestMessage(event.sender, payload);
  }
});
manager.subscribe((state) => {
  if (host && !host.isDestroyed()) host.webContents.send("synara-stack:state", state);
});
manager.subscribeCopyLink((event) => {
  if (host && !host.isDestroyed()) host.webContents.send("synara-stack:copy-link", event);
});
const pipeServer = new BrowserUsePipeServer(manager, {
  pipePath: required("SYNARA_BROWSER_HOST_PIPE_PATH"),
  capability: required("SYNARA_BROWSER_HOST_CAPABILITY"),
  requestOpenPanel(requestedThreadId) {
    if (requestedThreadId !== threadId || !host || host.isDestroyed()) {
      throw new Error("Unexpected native-stack tool scope");
    }
    host.webContents.send("synara-stack:show-panel");
  },
});
// Inspection reads existing maps; it must never claim an automation runtime or
// bypass the production tool host, focus epochs, popup correlation or eviction.
Object.assign(globalThis, { __synaraNativeStackEvidence: { manager, threadId } });

app.whenReady().then(async () => {
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  browserSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    isClipboardWritePermission(contents, permission, details, origin),
  );
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isClipboardWritePermission(contents, permission, details)),
  );
  host = new BrowserWindow({
    width: 1280,
    height: 900,
    useContentSize: true,
    show: true,
    webPreferences: {
      preload: required("SYNARA_NATIVE_STACK_UI_PRELOAD"),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  manager.setWindow(host);
  host.webContents.on("will-attach-webview", (event, preferences, params) => {
    if (typeof params.partition !== "string") {
      event.preventDefault();
      return;
    }
    if (
      !hardenBrowserAnnotationWebviewPreferences({
        partition: params.partition,
        expectedPartition: BROWSER_SESSION_PARTITION,
        preloadPath: managerOptions.annotationPreloadPath,
        webPreferences: preferences,
      })
    )
      event.preventDefault();
  });
  await host.loadURL(required("SYNARA_NATIVE_STACK_UI_URL"));
  await pipeServer.start();
  Object.assign(globalThis, { __synaraNativeStackPipeReady: true });
});
app.on("before-quit", () => {
  manager.dispose();
  void pipeServer.dispose();
});
