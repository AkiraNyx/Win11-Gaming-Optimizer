"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const STARTUP_SHELL_PATH = path.join(__dirname, "startup-shell.html");
const STARTUP_SHELL_URL = pathToFileURL(STARTUP_SHELL_PATH).href;
const STARTUP_STAGES = Object.freeze([
  Object.freeze({ id: "loading-service", label: "正在加载服务模块" }),
  Object.freeze({ id: "starting-service", label: "正在启动本地服务" }),
  Object.freeze({ id: "initializing-runtime", label: "正在初始化受保护运行环境，系统修改暂不可用。" }),
  Object.freeze({ id: "reading-system-status", label: "正在读取系统状态，请稍候。" }),
]);

const IPC = Object.freeze({
  minimize: "win11optimizer:window-minimize",
  toggleMaximize: "win11optimizer:window-toggle-maximize",
  close: "win11optimizer:window-close",
  maximizeChanged: "win11optimizer:window-maximize-changed",
  startupState: "win11optimizer:startup-state",
});

process.env.OPTIMIZER_NO_BROWSER = "1";
process.env.WIN11OPT_ELECTRON_PACKAGED = app.isPackaged ? "1" : "0";

let mainWindow = null;
let localOrigin = null;
let serverStartPromise = null;
let serverRuntime = null;
let shutdownPromise = null;
let quitPromise = null;
let quitting = false;
let cleanupComplete = false;

function isTrustedRendererUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.href === STARTUP_SHELL_URL
      || (localOrigin !== null && parsed.origin === localOrigin);
  } catch {
    return false;
  }
}

function setTrustedLocalUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("The local service returned an untrusted URL");
  }
  localOrigin = parsed.origin;
  return parsed.href;
}

function isMainWindowSender(event) {
  const senderFrame = event.senderFrame;
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  return Boolean(
    senderFrame
    && senderFrame.frameTreeNodeId === mainWindow.webContents.mainFrame.frameTreeNodeId
    && isTrustedRendererUrl(senderFrame.url),
  );
}

function registerWindowIpc() {
  ipcMain.on(IPC.minimize, (event) => {
    if (isMainWindowSender(event)) mainWindow.minimize();
  });
  ipcMain.on(IPC.toggleMaximize, (event) => {
    if (!isMainWindowSender(event)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on(IPC.close, (event) => {
    if (isMainWindowSender(event)) mainWindow.close();
  });
}

function configureWebContents(window) {
  const { webContents } = window;
  const denyUntrustedNavigation = (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  };

  webContents.on("will-navigate", denyUntrustedNavigation);
  webContents.on("will-redirect", denyUntrustedNavigation);
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.session.setPermissionCheckHandler(() => false);
  webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function sendStartupState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.startupState, state);
  }
}

function sendStartupStage(index) {
  const stage = STARTUP_STAGES[index];
  sendStartupState({
    kind: "progress",
    id: stage.id,
    label: stage.label,
    current: index + 1,
    total: STARTUP_STAGES.length,
  });
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: true,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = window;
  configureWebContents(window);

  const sendMaximizeState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.maximizeChanged, window.isMaximized());
    }
  };

  window.on("maximize", sendMaximizeState);
  window.on("unmaximize", sendMaximizeState);
  window.webContents.on("did-finish-load", sendMaximizeState);
  window.once("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  await window.loadFile(STARTUP_SHELL_PATH);
  return window;
}

function shutdownServer() {
  if (!shutdownPromise) {
    shutdownPromise = Promise.resolve()
      .then(async () => {
        if (!serverRuntime && serverStartPromise) {
          try {
            serverRuntime = await serverStartPromise;
          } catch {
            return;
          }
        }
        await serverRuntime?.close();
      })
      .catch((error) => console.error("[electron] Failed to stop the local service:", error))
      .finally(() => {
        serverRuntime = null;
      });
  }
  return shutdownPromise;
}

function quitCleanly() {
  quitting = true;
  if (!quitPromise) {
    quitPromise = shutdownServer().finally(() => {
      cleanupComplete = true;
      app.quit();
    });
  }
  return quitPromise;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function startupErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "启动过程中发生未知错误。";
}

async function showStartupFailure(error) {
  console.error("[electron] Startup failed:", error);
  await shutdownServer();
  if (quitting) return;

  try {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The startup window is unavailable");
    if (mainWindow.webContents.getURL() !== STARTUP_SHELL_URL) {
      await mainWindow.loadFile(STARTUP_SHELL_PATH);
    }
    sendStartupState({
      kind: "error",
      label: "应用未能启动",
      detail: startupErrorMessage(error),
    });
  } catch (shellError) {
    console.error("[electron] Failed to display the startup error:", shellError);
    dialog.showErrorBox("Win11 Optimizer 启动失败", startupErrorMessage(error));
    await quitCleanly();
  }
}

async function startApplication() {
  const window = await createMainWindow();
  if (quitting || window.isDestroyed()) return;

  sendStartupStage(0);
  const { initializeRuntime, startServer } = require("../server.js");
  if (quitting || window.isDestroyed()) return;

  sendStartupStage(1);
  serverStartPromise = Promise.resolve().then(() => startServer({
    port: 0,
    openBrowser: false,
    installShutdownHandlers: false,
  }));
  serverRuntime = await serverStartPromise;
  if (quitting || window.isDestroyed()) return;

  sendStartupStage(2);
  const url = setTrustedLocalUrl(serverRuntime.url);
  await initializeRuntime().catch(() => undefined);
  if (quitting || window.isDestroyed()) return;

  sendStartupStage(3);
  await window.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerWindowIpc();
  app.on("second-instance", focusMainWindow);
  app.on("window-all-closed", () => void quitCleanly());
  app.on("before-quit", (event) => {
    if (cleanupComplete) return;
    event.preventDefault();
    void quitCleanly();
  });

  void app.whenReady()
    .then(startApplication)
    .catch(showStartupFailure);
}
