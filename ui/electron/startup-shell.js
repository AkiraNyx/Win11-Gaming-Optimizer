"use strict";

const api = window.win11Optimizer;
const main = document.getElementById("main");
const startupContent = document.getElementById("startup-content");
const errorContent = document.getElementById("error-content");
const errorDetail = document.getElementById("error-detail");
const status = document.getElementById("status");
const progress = document.getElementById("progress");
const progressSegments = Array.from(document.querySelectorAll(".progress-segment"));
const minimizeButton = document.getElementById("minimize");
const maximizeButton = document.getElementById("toggle-maximize");
const closeButton = document.getElementById("close");
const exitButton = document.getElementById("exit");
const maximizeIcon = document.getElementById("maximize-icon");
const restoreIcon = document.getElementById("restore-icon");

function showFailure(detail) {
  main.setAttribute("aria-busy", "false");
  startupContent.hidden = true;
  errorContent.hidden = false;
  errorDetail.textContent = detail || "启动过程中发生未知错误。";
  exitButton.focus();
}

function updateProgress(state) {
  const total = Number.isInteger(state.total) && state.total > 0 ? state.total : progressSegments.length;
  const current = Number.isInteger(state.current) ? Math.min(Math.max(state.current, 0), total) : 0;
  const label = typeof state.label === "string" && state.label ? state.label : "正在启动应用";
  status.textContent = label;
  progress.setAttribute("aria-valuemax", String(total));
  progress.setAttribute("aria-valuenow", String(current));
  progress.setAttribute("aria-valuetext", label);
  progressSegments.forEach((segment, index) => {
    segment.classList.toggle("complete", index < current - 1);
    segment.classList.toggle("active", index === current - 1);
  });
}

if (!api) {
  showFailure("无法连接到桌面应用接口。");
} else {
  minimizeButton.addEventListener("click", () => api.minimize());
  maximizeButton.addEventListener("click", () => api.toggleMaximize());
  closeButton.addEventListener("click", () => api.close());
  exitButton.addEventListener("click", () => api.close());

  const unsubscribeMaximize = api.onMaximizeChange((maximized) => {
    maximizeIcon.hidden = maximized;
    restoreIcon.hidden = !maximized;
    maximizeButton.setAttribute("aria-label", maximized ? "还原窗口" : "最大化窗口");
    maximizeButton.setAttribute("title", maximized ? "还原窗口" : "最大化窗口");
  });

  const unsubscribeStartup = api.onStartupState((state) => {
    if (!state || typeof state !== "object") return;
    if (state.kind === "error") {
      showFailure(typeof state.detail === "string" ? state.detail : "启动过程中发生未知错误。");
      return;
    }
    if (state.kind === "progress") updateProgress(state);
  });

  window.addEventListener("pagehide", () => {
    unsubscribeMaximize();
    unsubscribeStartup();
  }, { once: true });
}
