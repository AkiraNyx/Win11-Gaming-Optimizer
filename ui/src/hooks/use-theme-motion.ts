"use client";

import { animate, createScope } from "animejs";
import { motionTokens, useReducedMotion, type ThemeName } from "@arinox/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

const colors = [
  "--ax-color-bg-default", "--ax-color-bg-subtle", "--ax-color-surface-raised",
  "--ax-color-text-default", "--ax-color-text-muted", "--ax-color-text-subtle",
  "--ax-color-state-hover", "--ax-color-state-selected", "--ax-color-accent-default",
  "--ax-color-accent-hover", "--ax-color-accent-subtle", "--ax-color-accent-text", "--ax-color-accent-fg",
  "--ax-color-border-default", "--ax-color-border-strong", "--ax-color-focus-ring",
  "--ax-color-danger", "--ax-color-danger-fg", "--ax-color-success", "--ax-color-warning",
  "--fx-paper", "--fx-paper-inset", "--fx-glass-fill", "--fx-glass-rim", "--fx-glass-solid",
  "--fx-glass-sheen", "--fx-glass-bottom", "--fx-horizon", "--fx-scrollbar",
] as const;
function snapshot(node: HTMLElement) {
  const style = getComputedStyle(node);
  return Object.fromEntries(colors.map(name => [name, style.getPropertyValue(name).trim()]));
}

export function useThemeMotion(root: RefObject<HTMLDivElement | null>, theme: ThemeName) {
  const pending = useRef<Record<string, string> | null>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = root.current;
    const from = pending.current;
    pending.current = null;
    if (!node || !from || reduced) return;
    const target = snapshot(node);
    const properties = Object.fromEntries(colors.filter(name => from[name] && target[name] && from[name] !== target[name]).map(name => [name, [from[name], target[name]]]));
    if (!Object.keys(properties).length) return;
    let live = true, completed = false;
    node.setAttribute("data-theme-motion", "running");
    const scope = createScope({ root: node }).add(() => {
      const tokens = motionTokens(node);
      animate(node, { ...properties, duration: tokens.base, ease: tokens.enter,
        onComplete: () => {
          if (!live) return;
          completed = true;
          node.setAttribute("data-theme-motion", "idle");
          for (const name of colors) node.style.removeProperty(name);
        },
      });
    });
    return () => {
      live = false;
      if (!completed) pending.current = snapshot(node);
      scope.revert();
      node.setAttribute("data-theme-motion", "idle");
    };
  }, [theme, reduced, root]);
  // Only an explicit toggle animates; hydration and saved theme restoration stay immediate.
  return () => { if (root.current) pending.current = snapshot(root.current); };
}
