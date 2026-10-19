"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ELECTRON_DIR = __dirname;
const MAIN_PATH = path.join(ELECTRON_DIR, "main.cjs");
const PRELOAD_PATH = path.join(ELECTRON_DIR, "preload.cjs");
const SHELL_PATH = path.join(ELECTRON_DIR, "startup-shell.html");
const SHELL_SCRIPT_PATH = path.join(ELECTRON_DIR, "startup-shell.js");
const HEADER_PATH = path.join(ELECTRON_DIR, "..", "src", "components", "layout", "header.tsx");
const API_PATH = path.join(ELECTRON_DIR, "..", "src", "lib", "api.ts");
const SHELL_URL = pathToFileURL(SHELL_PATH).href;
const STARTUP_CHANNEL = "win11optimizer:startup-state";
const SESSION_TOKEN = "a".repeat(64);

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the Electron startup test");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function runMain(options = {}) {
  const events = [];
  const ipcHandlers = new Map();
  const windows = [];
  let serverCloseCalls = 0;
  let quitCalls = 0;

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.id = 42;
      this.url = "";
      this.mainFrame = { url: "", frameTreeNodeId: 1 };
      this.session = {
        setPermissionCheckHandler: (handler) => { this.permissionCheckHandler = handler; },
        setPermissionRequestHandler: (handler) => { this.permissionRequestHandler = handler; },
        webRequest: {
          onBeforeSendHeaders: (filter, handler) => {
            this.beforeSendHeadersFilter = filter;
            this.beforeSendHeadersHandler = handler;
          },
        },
      };
    }

    getURL() { return this.url; }
    send(channel, state) { events.push({ type: "send", channel, state }); }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(windowOptions) {
      super();
      this.options = windowOptions;
      this.webContents = new FakeWebContents();
      this.destroyed = false;
      this.maximized = false;
      this.minimized = false;
      this.loaded = [];
      windows.push(this);
      events.push({ type: "window-created", options: windowOptions });
    }

    isDestroyed() { return this.destroyed; }
    isMaximized() { return this.maximized; }
    isMinimized() { return this.minimized; }
    minimize() { this.minimized = true; events.push({ type: "minimize" }); }
    restore() { this.minimized = false; events.push({ type: "restore" }); }
    maximize() { this.maximized = true; this.emit("maximize"); }
    unmaximize() { this.maximized = false; this.emit("unmaximize"); }
    setBackgroundColor(color) { this.options.backgroundColor = color; }
    show() { events.push({ type: "show" }); }
    focus() { events.push({ type: "focus" }); }

    async loadFile(filePath) {
      const url = pathToFileURL(filePath).href;
      this.loaded.push(url);
      this.webContents.url = url;
      this.webContents.mainFrame.url = url;
      events.push({ type: "load-file", url });
      if (options.failShell) throw new Error("shell failed");
      this.webContents.emit("did-finish-load");
    }

    async loadURL(url) {
      this.loaded.push(url);
      events.push({ type: "load-url", url });
      if (options.failNavigation) throw new Error("navigation failed");
      this.webContents.url = url;
      this.webContents.mainFrame.url = url;
      this.webContents.emit("did-finish-load");
    }

    close() {
      if (this.destroyed) return;
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.emit("close", event);
      if (event.defaultPrevented) return;
      this.destroyed = true;
      events.push({ type: "close" });
      this.emit("closed");
      app.emit("window-all-closed");
    }
  }

  const app = new EventEmitter();
  app.isPackaged = false;
  app.getPath = name => { assert.equal(name, "userData"); return ELECTRON_DIR; };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.quit = () => { quitCalls++; events.push({ type: "quit" }); };

  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: { showErrorBox: (title, detail) => events.push({ type: "dialog", title, detail }) },
    ipcMain: { on: (channel, handler) => ipcHandlers.set(channel, handler), handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  };

  const startServer = async () => {
    events.push({ type: "start-server" });
    if (options.failServer) throw new Error("service failed");
    return {
      url: `http://127.0.0.1:43123/#session=${SESSION_TOKEN}`,
      sessionToken: SESSION_TOKEN,
      get busy() { return options.backendBusy === true; },
      close: async () => { serverCloseCalls++; events.push({ type: "close-server" }); },
    };
  };
  const initializeRuntime = async () => {
    events.push({ type: "initialize-runtime" });
    if (options.failRuntime) throw new Error("runtime failed");
  };

  const source = fs.readFileSync(MAIN_PATH, "utf8");
  const originalPackaged = process.env.WIN11OPT_ELECTRON_PACKAGED;
  const originalNoBrowser = process.env.OPTIMIZER_NO_BROWSER;
  vm.runInNewContext(source, {
    __dirname: ELECTRON_DIR,
    __filename: MAIN_PATH,
    Buffer,
    Error,
    Promise,
    URL,
    console: {
      error: (...args) => events.push({ type: "console-error", args }),
      log: (...args) => events.push({ type: "console-log", args }),
    },
    module: { exports: {} },
    exports: {},
    process,
    require: (request) => {
      if (request === "electron") return electron;
      if (request === "./theme-store.cjs") {
        let theme = options.theme || "day";
        return { createThemeStore: () => ({ get: () => theme, set: next => { theme = next; } }) };
      }
      if (request === "../server.js") {
        events.push({ type: "require-server" });
        return { initializeRuntime, startServer };
      }
      return require(request);
    },
  }, { filename: MAIN_PATH });

  const complete = () => events.some((event) => (
    event.type === "load-url"
    || (event.type === "send" && event.channel === STARTUP_CHANNEL && event.state?.kind === "error")
    || event.type === "dialog"
  ));
  await waitFor(complete);

  if (originalPackaged === undefined) delete process.env.WIN11OPT_ELECTRON_PACKAGED;
  else process.env.WIN11OPT_ELECTRON_PACKAGED = originalPackaged;
  if (originalNoBrowser === undefined) delete process.env.OPTIMIZER_NO_BROWSER;
  else process.env.OPTIMIZER_NO_BROWSER = originalNoBrowser;

  return {
    app,
    events,
    ipcHandlers,
    windows,
    get quitCalls() { return quitCalls; },
    get serverCloseCalls() { return serverCloseCalls; },
  };
}

test("Electron startup shows the shell before starting the service and reuses one window", async () => {
  const run = await runMain();
  assert.equal(run.windows.length, 1);
  const [window] = run.windows;
  assert.equal(window.options.show, true);
  assert.equal(window.options.backgroundColor, "#fdfaf4");
  assert.equal(window.listenerCount("ready-to-show"), 0);
  assert.deepEqual(window.loaded, [SHELL_URL, "http://127.0.0.1:43123/#startup"]);
  assert.equal(window.webContents.beforeSendHeadersFilter.urls.length, 1);
  assert.equal(
    window.webContents.beforeSendHeadersFilter.urls[0],
    "http://127.0.0.1:43123/api/*",
  );

  const injectHeaders = (details) => new Promise((resolve) => {
    window.webContents.beforeSendHeadersHandler(details, resolve);
  });
  const mainWindowRequest = await injectHeaders({
    webContentsId: window.webContents.id,
    requestHeaders: { Accept: "application/json" },
  });
  assert.equal(mainWindowRequest.requestHeaders.Accept, "application/json");
  assert.equal(mainWindowRequest.requestHeaders["X-Win11Opt-Session"], SESSION_TOKEN);
  assert.equal(Object.keys(mainWindowRequest.requestHeaders).length, 2);
  const otherWindowRequest = await injectHeaders({
    webContentsId: window.webContents.id + 1,
    requestHeaders: { Accept: "application/json" },
  });
  assert.equal(otherWindowRequest.requestHeaders.Accept, "application/json");
  assert.equal(otherWindowRequest.requestHeaders["X-Win11Opt-Session"], undefined);
  assert.equal(Object.keys(otherWindowRequest.requestHeaders).length, 1);

  const relevant = run.events
    .filter((event) => event.type === "load-file"
      || event.type === "require-server"
      || event.type === "start-server"
      || event.type === "initialize-runtime"
      || event.type === "load-url"
      || (event.type === "send" && event.channel === STARTUP_CHANNEL))
    .map((event) => event.state?.id || event.type);
  assert.deepEqual(relevant, [
    "load-file",
    "loading-service",
    "require-server",
    "starting-service",
    "start-server",
    "initializing-runtime",
    "initialize-runtime",
    "reading-system-status",
    "load-url",
  ]);

  window.webContents.url = SHELL_URL;
  window.webContents.mainFrame.url = SHELL_URL;
  const minimize = run.ipcHandlers.get("win11optimizer:window-minimize");
  const toggleMaximize = run.ipcHandlers.get("win11optimizer:window-toggle-maximize");
  const close = run.ipcHandlers.get("win11optimizer:window-close");
  const trustedEvent = {
    sender: window.webContents,
    senderFrame: { url: SHELL_URL, frameTreeNodeId: window.webContents.mainFrame.frameTreeNodeId },
  };
  assert.notStrictEqual(trustedEvent.senderFrame, window.webContents.mainFrame);
  minimize(trustedEvent);
  assert.equal(window.minimized, true);

  toggleMaximize(trustedEvent);
  assert.equal(window.maximized, true);
  toggleMaximize(trustedEvent);
  assert.equal(window.maximized, false);

  window.minimized = false;
  minimize({
    sender: window.webContents,
    senderFrame: { url: SHELL_URL, frameTreeNodeId: 2 },
  });
  assert.equal(window.minimized, false);
  minimize({ sender: {}, senderFrame: trustedEvent.senderFrame });
  assert.equal(window.minimized, false);
  minimize({ sender: window.webContents, senderFrame: null });
  assert.equal(window.minimized, false);

  close({
    sender: window.webContents,
    senderFrame: { url: "file:///untrusted.html", frameTreeNodeId: window.webContents.mainFrame.frameTreeNodeId },
  });
  assert.equal(window.isDestroyed(), false);
  close(trustedEvent);
  await waitFor(() => run.quitCalls === 1);
  assert.equal(run.serverCloseCalls, 1);
});

test("Electron startup failure remains in the shell", async () => {
  const run = await runMain({ failServer: true });
  assert.equal(run.windows.length, 1);
  assert.deepEqual(run.windows[0].loaded, [SHELL_URL]);
  const failure = run.events.find((event) => event.type === "send"
    && event.channel === STARTUP_CHANNEL
    && event.state?.kind === "error");
  assert.equal(failure.state.label, "应用未能启动");
  assert.equal(failure.state.detail, "service failed");
  assert.equal(run.events.some((event) => event.type === "dialog"), false);
  assert.equal(run.quitCalls, 0);
});

test("runtime initialization failure still hands off to the main interface", async () => {
  const run = await runMain({ failRuntime: true });
  assert.deepEqual(run.windows[0].loaded, [SHELL_URL, "http://127.0.0.1:43123/#startup"]);
  assert.equal(run.events.some((event) => event.type === "send"
    && event.channel === STARTUP_CHANNEL
    && event.state?.kind === "error"), false);
});

test("preload exposes only wrapped window and startup APIs", () => {
  const listeners = new Map();
  const sent = [];
  let exposed;
  const source = fs.readFileSync(PRELOAD_PATH, "utf8");
  vm.runInNewContext(source, {
    Object,
    require: (request) => {
      assert.equal(request, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
        ipcRenderer: {
          on: (channel, listener) => listeners.set(channel, listener),
          removeListener: (channel, listener) => {
            if (listeners.get(channel) === listener) listeners.delete(channel);
          },
          send: (channel) => sent.push(channel),
        },
      };
    },
  }, { filename: PRELOAD_PATH });

  assert.deepEqual(Object.keys(exposed).sort(), ["close", "getTheme", "minimize", "onMaximizeChange", "onStartupState", "setCloseBlocked", "setTheme", "toggleMaximize"]);
  exposed.minimize();
  assert.deepEqual(sent, ["win11optimizer:window-minimize"]);

  let received;
  const unsubscribe = exposed.onStartupState((state) => { received = state; });
  const state = { kind: "progress", label: "正在加载服务模块", current: 1, total: 4 };
  listeners.get(STARTUP_CHANNEL)({ sender: "must not escape" }, state);
  assert.strictEqual(received, state);
  unsubscribe();
  assert.equal(listeners.has(STARTUP_CHANNEL), false);
});

test("renderer API authentication separates standalone and Electron sessions", async () => {
  const source = fs.readFileSync(API_PATH, "utf8");
  assert.doesNotMatch(source, /sessionStorage/);

  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let request;
  try {
    globalThis.window = {
      location: { hash: `#session=${SESSION_TOKEN}` },
    };
    globalThis.fetch = async (...args) => { request = args; return { ok: true }; };
    const standaloneApi = await import(`${pathToFileURL(API_PATH).href}?standalone`);
    await standaloneApi.apiFetch("/api/status", { headers: { Accept: "application/json" } });
    assert.equal(request[1].headers.get("Accept"), "application/json");
    assert.equal(request[1].headers.get("X-Win11Opt-Session"), SESSION_TOKEN);

    request = undefined;
    globalThis.window = {
      location: { hash: "#startup" },
    };
    const electronApi = await import(`${pathToFileURL(API_PATH).href}?electron`);
    await electronApi.apiFetch("/api/status", { headers: { Accept: "application/json" } });
    assert.equal(request[1].headers.Accept, "application/json");
    assert.equal(request[1].headers["X-Win11Opt-Session"], undefined);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("startup shell keeps progress and failure states accessible", () => {
  const html = fs.readFileSync(SHELL_PATH, "utf8");
  const script = fs.readFileSync(SHELL_SCRIPT_PATH, "utf8");
  const header = fs.readFileSync(HEADER_PATH, "utf8");
  assert.match(html, /Content-Security-Policy[^>]+script-src 'self'/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /animation: startup-shell-enter var\(--ax-motion-duration-base\)/);
  assert.equal((html.match(/class="progress-segment"/g) || []).length, 4);
  assert.equal(fs.existsSync(path.join(ELECTRON_DIR, "arinox/assets/fonts/inter-latin-wght-normal.woff2")), true);
  assert.equal(fs.existsSync(path.join(ELECTRON_DIR, "arinox/assets/fonts/newsreader-latin-opsz-normal.woff2")), true);
  assert.match(script, /errorDetail\.textContent =/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /minimizeButton\.addEventListener\("click", \(\) => api\.minimize\(\)\)/);
  assert.match(script, /maximizeButton\.addEventListener\("click", \(\) => api\.toggleMaximize\(\)\)/);
  assert.match(script, /closeButton\.addEventListener\("click", \(\) => api\.close\(\)\)/);
  assert.match(header, /onClick=\{\(\) => electronWindow\.minimize\(\)\}/);
  assert.match(header, /onClick=\{\(\) => electronWindow\.toggleMaximize\(\)\}/);
  assert.match(header, /onClick=\{\(\) => electronWindow\.close\(\)\}/);
  assert.doesNotMatch(header, /onClick=\{electronWindow\.(?:minimize|toggleMaximize|close)\}/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test("preload keeps the startup handoff visible until initial status loading and its exit transition settle", async () => {
  const source = fs.readFileSync(PRELOAD_PATH, "utf8");
  const elements = [];
  let observerCallback;
  let applicationReady = false;
  let exposed;
  let finishTransition;
  const transitionFinished = new Promise(resolve => { finishTransition = resolve; });

  function fakeElement(tagName) {
    const element = {
      tagName,
      children: [],
      dataset: {},
      attributes: new Map(),
      className: "",
      id: "",
      removed: false,
      textContent: "",
      listeners: new Map(),
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      append(...children) { this.children.push(...children); },
      remove() { this.removed = true; },
      setAttribute(name, value) { this.attributes.set(name, value); },
      getAnimations() { return [{ finished: transitionFinished }]; },
    };
    elements.push(element);
    return element;
  }

  const head = fakeElement("head");
  const body = fakeElement("body");
  const document = {
    body,
    head,
    readyState: "complete",
    createElement: fakeElement,
    getElementById: (id) => elements.find((element) => element.id === id && !element.removed) || null,
    querySelector: (selector) => selector === 'main[aria-busy="false"]' && applicationReady ? {} : null,
  };
  class FakeMutationObserver {
    constructor(callback) { observerCallback = callback; }
    disconnect() {}
    observe() {}
  }
  const window = {
    location: { protocol: "http:", hostname: "127.0.0.1", hash: "#startup" },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => { callback(); return 1; },
    addEventListener() {},
  };

  vm.runInNewContext(source, {
    MutationObserver: FakeMutationObserver,
    Object,
    clearTimeout: () => {},
    document,
    setTimeout: () => 1,
    window,
    require: (request) => {
      assert.equal(request, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
        ipcRenderer: { on() {}, removeListener() {}, send() {} },
      };
    },
  }, { filename: PRELOAD_PATH });

  assert.ok(exposed);
  const overlay = elements.find((element) => element.id === "win11optimizer-startup-handoff");
  assert.ok(overlay);
  assert.equal(overlay.removed, false);
  assert.equal(elements.some((element) => element.textContent === "正在读取系统状态，请稍候。"), true);

  applicationReady = true;
  observerCallback();
  assert.equal(overlay.classList.contains("is-leaving"), true);
  assert.equal(overlay.removed, false);
  finishTransition();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlay.removed, true);
});

test("native theme IPC validates the sender and value and restores the saved startup background", async () => {
  const run = await runMain({ theme: "night" });
  const window = run.windows[0];
  assert.equal(window.options.backgroundColor, "#070a12");
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  run.ipcHandlers.get("win11optimizer:theme-read")(trusted);
  assert.equal(trusted.returnValue, "night");
  const save = run.ipcHandlers.get("win11optimizer:theme-save");
  assert.equal(await save({ ...trusted, senderFrame: { frameTreeNodeId: 99, url: "https://example.invalid" } }, "day"), false);
  assert.equal(await save(trusted, "invalid"), false);
  assert.equal(window.options.backgroundColor, "#070a12");
  assert.equal(await save(trusted, "day"), true);
  assert.equal(window.options.backgroundColor, "#fdfaf4");
});

test("window state snapshots and close protection require the trusted main renderer", async () => {
  const options = { backendBusy: false };
  const run = await runMain(options);
  const window = run.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const untrusted = { sender: window.webContents, senderFrame: { url: SHELL_URL, frameTreeNodeId: 99 } };
  const read = run.ipcHandlers.get("win11optimizer:window-maximize-read");
  const setBlocked = run.ipcHandlers.get("win11optimizer:window-close-blocked");
  window.maximize();
  read(trusted);
  assert.equal(trusted.returnValue, true);
  read(untrusted);
  assert.equal(untrusted.returnValue, undefined);
  setBlocked(untrusted, true);
  assert.equal(untrusted.returnValue, false);
  setBlocked(trusted, "true");
  assert.equal(trusted.returnValue, false);
  setBlocked(trusted, true);
  assert.equal(trusted.returnValue, true);

  run.ipcHandlers.get("win11optimizer:window-close")(trusted);
  window.close(); // Covers native close/Alt+F4 using the same BrowserWindow close event.
  assert.equal(window.isDestroyed(), false);
  run.ipcHandlers.get("win11optimizer:window-minimize")(trusted);
  assert.equal(window.minimized, true);
  run.ipcHandlers.get("win11optimizer:window-toggle-maximize")(trusted);
  assert.equal(window.maximized, false);
  let quitPrevented = false;
  run.app.emit("before-quit", { preventDefault() { quitPrevented = true; } });
  assert.equal(quitPrevented, true);
  assert.equal(run.serverCloseCalls, 0);

  setBlocked(trusted, false);
  options.backendBusy = true;
  window.close();
  assert.equal(window.isDestroyed(), false);
  run.app.emit("before-quit", { preventDefault() {} });
  assert.equal(run.serverCloseCalls, 0);
  options.backendBusy = false;
  window.close();
  await waitFor(() => run.quitCalls === 1);
  assert.equal(run.serverCloseCalls, 1);
});

test("preload replays early maximize state and guards busy reload without exposing IPC events", () => {
  const ipcListeners = new Map();
  const windowListeners = new Map();
  const commands = [];
  let exposed;
  vm.runInNewContext(fs.readFileSync(PRELOAD_PATH, "utf8"), {
    window: { location: { protocol: "file:" }, addEventListener: (name, listener) => windowListeners.set(name, listener) },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
      ipcRenderer: {
        on: (name, listener) => ipcListeners.set(name, listener),
        removeListener() {},
        send() {},
        sendSync: (name, value) => {
          if (name === "win11optimizer:window-maximize-read") return true;
          if (name === "win11optimizer:window-close-blocked") { commands.push(value); return true; }
          return "day";
        },
      },
    }),
  }, { filename: PRELOAD_PATH });

  const states = [];
  let off = exposed.onMaximizeChange((...args) => states.push(args));
  assert.deepEqual(states, [[true]]);
  off();
  ipcListeners.get("win11optimizer:window-maximize-changed")({ secret: "must not escape" }, false);
  off = exposed.onMaximizeChange((...args) => states.push(args));
  assert.deepEqual(states, [[true], [false]]);
  ipcListeners.get("win11optimizer:window-maximize-changed")({}, true);
  assert.deepEqual(states, [[true], [false], [true]]);
  off();
  ipcListeners.get("win11optimizer:window-maximize-changed")({}, false);
  assert.equal(states.length, 3);

  assert.equal(exposed.setCloseBlocked("true"), false);
  assert.equal(exposed.setCloseBlocked(true), true);
  const blocked = { prevented: false, preventDefault() { this.prevented = true; } };
  windowListeners.get("beforeunload")(blocked);
  assert.equal(blocked.prevented, true);
  assert.equal(blocked.returnValue, false);
  assert.equal(exposed.setCloseBlocked(false), true);
  const idle = { prevented: false, preventDefault() { this.prevented = true; } };
  windowListeners.get("beforeunload")(idle);
  assert.equal(idle.prevented, false);
  assert.deepEqual(commands, [true, false]);
});
