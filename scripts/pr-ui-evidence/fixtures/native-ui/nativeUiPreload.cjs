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
  browser[method] = (input) => ipcRenderer.invoke("synara-evidence:browser", method, input);
function subscribe(channel, listener) {
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
browser.onState = (listener) => subscribe("synara-evidence:state", listener);
browser.onCopyLink = (listener) => subscribe("synara-evidence:copy-link", listener);
window.nativeApi = { browser };
