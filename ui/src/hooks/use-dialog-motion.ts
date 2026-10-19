"use client";

import { animate, createScope } from "animejs";
import { motionTokens, useReducedMotion } from "@arinox/react";
import { useLayoutEffect } from "react";

export function useDialogMotion(node: HTMLDialogElement | null, open: boolean) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const body = node?.querySelector<HTMLElement>(".optimizer-dialog-body");
    if (!node || !body || !open) return;
    let height = node.offsetHeight, live = true;
    let scope: ReturnType<typeof createScope> | undefined;
    let animation: ReturnType<typeof animate> | undefined;
    const observer = new ResizeObserver(() => {
      if (!live || !node.open) return;
      const style = getComputedStyle(node);
      const extra = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const maximum = parseFloat(style.maxHeight);
      const next = Math.min(body.offsetHeight + extra, Number.isFinite(maximum) ? maximum : Infinity);
      if (Math.abs(next - height) < 1) return;
      const from = animation && !animation.completed ? node.offsetHeight : height;
      const opacity = getComputedStyle(body).opacity;
      animation?.cancel(); scope?.revert();
      height = next;
      if (reduced) return;
      node.setAttribute("data-resize-state", "running");
      scope = createScope({ root: node }).add(() => {
        const tokens = motionTokens(node);
        animation = animate(node, { height: [from, next], duration: tokens.base, ease: tokens.enter,
          onComplete: () => { if (live) { node.style.removeProperty("height"); body.style.removeProperty("opacity"); node.setAttribute("data-resize-state", "idle"); } },
        });
        animate(body, { opacity: [Math.min(Number(opacity), .7), 1], duration: tokens.fast, ease: tokens.enter });
      });
    });
    observer.observe(body);
    return () => { live = false; observer.disconnect(); animation?.cancel(); scope?.revert(); node.style.removeProperty("height"); body.style.removeProperty("opacity"); node.setAttribute("data-resize-state", "idle"); };
  }, [node, open, reduced]);
}
