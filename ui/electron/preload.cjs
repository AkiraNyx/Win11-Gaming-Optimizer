"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require("electron");

const IPC = Object.freeze({
  minimize: "win11optimizer:window-minimize",
  toggleMaximize: "win11optimizer:window-toggle-maximize",
  close: "win11optimizer:window-close",
  maximizeChanged: "win11optimizer:window-maximize-changed",
  readMaximizeState: "win11optimizer:window-maximize-read",
  setCloseBlocked: "win11optimizer:window-close-blocked",
  startupState: "win11optimizer:startup-state",
  readTheme: "win11optimizer:theme-read",
  saveTheme: "win11optimizer:theme-save",
});

let maximized = false;
let closeBlocked = false;
const maximizeListeners = new Set();
ipcRenderer.on(IPC.maximizeChanged, (_event, value) => {
  maximized = value === true;
  for (const listener of maximizeListeners) listener(maximized);
});
try { maximized = ipcRenderer.sendSync(IPC.readMaximizeState) === true; }
catch { /* Keep the default if the native state bridge is unavailable. */ }

let currentTheme = "day";
try { currentTheme = ipcRenderer.sendSync(IPC.readTheme) === "night" ? "night" : "day"; }
catch { /* Keep the default if the native preference bridge is unavailable. */ }
if (typeof document !== "undefined" && typeof window !== "undefined" && window.location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = currentTheme; }, { once: true });
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (!closeBlocked) return;
    event.preventDefault();
    event.returnValue = false;
  });
}

const STARTUP_HASH = "#startup";
const STARTUP_HANDOFF_ID = "win11optimizer-startup-handoff";

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function installStartupHandoff() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.location.protocol !== "http:"
    || window.location.hostname !== "127.0.0.1"
    || window.location.hash !== STARTUP_HASH) return;

  const mount = () => {
    if (!document.body || document.getElementById(STARTUP_HANDOFF_ID)) return;

    const style = createElement("style");
    style.id = `${STARTUP_HANDOFF_ID}-style`;
    style.textContent = `
      #${STARTUP_HANDOFF_ID} {
        position: fixed;
        inset: 84px 0 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 48px 24px;
        background: var(--ax-color-bg-default, ${currentTheme === "night" ? "#070a12" : "#fdfaf4"});
        color: var(--ax-color-text-default, ${currentTheme === "night" ? "#e6eaf0" : "#17191c"});
        font-family: var(--ax-font-family-sans), "Segoe UI", sans-serif;
        letter-spacing: 0;
        opacity: 1;
        transition: opacity var(--ax-motion-duration-base, 200ms) var(--ax-motion-easing-exit, ease-out);
      }
      #${STARTUP_HANDOFF_ID}.is-leaving { opacity: 0; }
      #${STARTUP_HANDOFF_ID} .handoff-content {
        width: min(420px, calc(100vw - 48px));
        text-align: center;
      }
      #${STARTUP_HANDOFF_ID} .handoff-clock {
        position: relative;
        width: 32px;
        height: 32px;
        margin: 0 auto 20px;
        border: 2px solid var(--ax-color-accent-text);
        border-radius: 50%;
      }
      #${STARTUP_HANDOFF_ID} .handoff-clock::before,
      #${STARTUP_HANDOFF_ID} .handoff-clock::after {
        position: absolute;
        left: 14px;
        top: 7px;
        width: 2px;
        height: 8px;
        border-radius: 1px;
        background: var(--ax-color-accent-text);
        content: "";
        transform-origin: 1px 8px;
      }
      #${STARTUP_HANDOFF_ID} .handoff-clock::after {
        height: 6px;
        transform: rotate(120deg);
      }
      #${STARTUP_HANDOFF_ID} h1 {
        margin: 0;
        font: 500 28px/1.5 var(--ax-font-family-display);
      }
      #${STARTUP_HANDOFF_ID} .handoff-status {
        min-height: 20px;
        margin: 8px 0 0;
        color: var(--ax-color-text-muted);
        font-size: 14px;
        line-height: 20px;
      }
      #${STARTUP_HANDOFF_ID} .handoff-progress {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        width: 100%;
        height: 4px;
        margin-top: 28px;
      }
      #${STARTUP_HANDOFF_ID} .handoff-segment {
        height: 4px;
        border-radius: 2px;
        background: var(--ax-color-accent-default);
      }
      #${STARTUP_HANDOFF_ID} .handoff-segment:last-child {
        animation: startup-handoff-pulse 1.2s ease-in-out infinite;
      }
      @keyframes startup-handoff-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.55; }
      }
      @media (prefers-reduced-motion: reduce) {
        #${STARTUP_HANDOFF_ID} { transition: none; }
        #${STARTUP_HANDOFF_ID} .handoff-segment:last-child { animation: none; }
      }
    `;

    const overlay = createElement("div", "ax-theme");
    overlay.dataset.theme = currentTheme;
    overlay.id = STARTUP_HANDOFF_ID;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-atomic", "true");
    overlay.setAttribute("aria-busy", "true");

    const content = createElement("div", "handoff-content");
    const clock = createElement("div", "handoff-clock");
    clock.setAttribute("aria-hidden", "true");
    content.append(clock);
    content.append(createElement("h1", "", "正在启动应用"));
    content.append(createElement("p", "handoff-status", "正在读取系统状态，请稍候。"));

    const progress = createElement("div", "handoff-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "启动进度");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "4");
    progress.setAttribute("aria-valuenow", "4");
    progress.setAttribute("aria-valuetext", "正在读取系统状态，请稍候。");
    for (let index = 0; index < 4; index += 1) {
      progress.append(createElement("span", "handoff-segment"));
    }
    content.append(progress);
    overlay.append(content);
    document.head.append(style);
    document.body.append(overlay);

    let leaving = false;
    let removed = false;
    let timeoutId;
    const observer = new MutationObserver(() => finishWhenReady());
    const detach = () => {
      if (removed) return;
      removed = true;
      overlay.remove();
      style.remove();
    };
    const remove = () => {
      if (leaving) return;
      leaving = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      overlay.setAttribute("aria-busy", "false");
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        window.requestAnimationFrame(detach);
        return;
      }
      window.requestAnimationFrame(() => {
        overlay.classList.add("is-leaving");
        const transitions = overlay.getAnimations();
        if (!transitions.length) detach();
        else void Promise.allSettled(transitions.map(animation => animation.finished)).then(detach);
      });
    };
    const finishWhenReady = () => {
      const applicationMain = document.querySelector('main[aria-busy="false"]');
      if (applicationMain) remove();
    };

    observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["aria-busy"] });
    timeoutId = setTimeout(remove, 70_000);
    finishWhenReady();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}

contextBridge.exposeInMainWorld("win11Optimizer", Object.freeze({
  getTheme: () => currentTheme,
  setTheme: async (theme) => {
    if (theme !== "day" && theme !== "night") return false;
    const saved = await ipcRenderer.invoke(IPC.saveTheme, theme);
    if (saved === true) currentTheme = theme;
    return saved === true;
  },
  minimize: () => ipcRenderer.send(IPC.minimize),
  toggleMaximize: () => ipcRenderer.send(IPC.toggleMaximize),
  close: () => ipcRenderer.send(IPC.close),
  setCloseBlocked: (blocked) => {
    if (typeof blocked !== "boolean") return false;
    const accepted = ipcRenderer.sendSync(IPC.setCloseBlocked, blocked) === true;
    if (accepted) closeBlocked = blocked;
    return accepted;
  },
  onMaximizeChange: (listener) => {
    if (typeof listener !== "function") return () => {};
    maximizeListeners.add(listener);
    listener(maximized);
    return () => maximizeListeners.delete(listener);
  },
  onStartupState: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handleChange = (_event, state) => listener(state);
    ipcRenderer.on(IPC.startupState, handleChange);
    return () => ipcRenderer.removeListener(IPC.startupState, handleChange);
  },
}));

installStartupHandoff();
