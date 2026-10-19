"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain } = require("electron");
process.on("uncaughtException", error => { console.error(error); app.exit(1); });
process.on("unhandledRejection", error => { console.error(error); app.exit(1); });
const { createThemeStore } = require("../../electron/theme-store.cjs");
const shell = path.resolve(__dirname, "../../electron/startup-shell.html");
const profile = process.env.WIN11OPT_UI_TEST_PROFILE;
if (!profile || !path.isAbsolute(profile)) {
  console.error("Native UI test requires an absolute WIN11OPT_UI_TEST_PROFILE");
  app.exit(1);
}
app.setPath("userData", profile);
let window, store, previewOrigin, closeBlocked = false;
const trusted = event => {
  try {
    return event.sender === window?.webContents
      && event.senderFrame?.frameTreeNodeId === window.webContents.mainFrame.frameTreeNodeId
      && (event.senderFrame.url === pathToFileURL(shell).href || new URL(event.senderFrame.url).origin === previewOrigin);
  } catch { return false; }
};
ipcMain.on("win11optimizer:theme-read", event => { event.returnValue = trusted(event) ? store.get() : undefined; });
ipcMain.on("win11optimizer:window-maximize-read", event => { event.returnValue = trusted(event) ? window.isMaximized() : undefined; });
ipcMain.on("win11optimizer:window-close-blocked", (event, blocked) => {
  event.returnValue = trusted(event) && typeof blocked === "boolean";
  if (event.returnValue) closeBlocked = blocked;
});
ipcMain.on("win11optimizer:window-minimize", event => { if (trusted(event)) window.minimize(); });
ipcMain.on("win11optimizer:window-toggle-maximize", event => {
  if (trusted(event)) { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
});
ipcMain.on("win11optimizer:window-close", event => { if (trusted(event)) window.close(); });
ipcMain.handle("win11optimizer:theme-save", (event, theme) => {
  if (!trusted(event) || !["day", "night"].includes(theme)) return false;
  store.set(theme);
  return true;
});
app.whenReady().then(async () => {
  store = createThemeStore(path.join(app.getPath("userData"), "arinox-ui-theme.json"));
  window = new BrowserWindow({ show: true, width: 1024, height: 720, webPreferences: {
    preload: path.resolve(__dirname, "../../electron/preload.cjs"),
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
  } });
  window.on("close", event => { if (closeBlocked) event.preventDefault(); });
  const sendState = () => window.webContents.send("win11optimizer:window-maximize-changed", window.isMaximized());
  window.on("maximize", sendState); window.on("unmaximize", sendState);
  window.webContents.on("did-finish-load", sendState);
  globalThis.loadPreview = async address => {
    const url = new URL(address);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Non-test origin");
    previewOrigin = url.origin;
    await window.loadURL(url.href);
  };
  await window.loadFile(shell);
});
app.on("window-all-closed", () => app.quit());
