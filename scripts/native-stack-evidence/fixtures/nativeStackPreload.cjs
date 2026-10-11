const { ipcRenderer } = require("electron");
const browser = {};
for (const method of [
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
])
  browser[method] = (input) => ipcRenderer.invoke("synara-stack:browser", method, input);
function subscribe(channel, listener) {
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
browser.onState = (listener) => subscribe("synara-stack:state", listener);
browser.onCopyLink = (listener) => subscribe("synara-stack:copy-link", listener);
// Local-server discovery belongs to the surrounding fixture shell and is empty;
// every browser method crosses the real desktop IPC/manager boundary above.
window.nativeApi = { browser, server: { listLocalServers: async () => [] } };
window.__synaraStackShell = {
  onShow: (listener) => subscribe("synara-stack:show-panel", listener),
};
