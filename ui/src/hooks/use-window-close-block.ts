"use client";

import { useLayoutEffect } from "react";

const blockers = new Set<symbol>();
export function useWindowCloseBlock(blocked: boolean) {
  useLayoutEffect(() => {
    if (!blocked) return;
    const token = Symbol();
    blockers.add(token);
    window.win11Optimizer?.setCloseBlocked?.(true);
    return () => {
      blockers.delete(token);
      window.win11Optimizer?.setCloseBlocked?.(blockers.size > 0);
    };
  }, [blocked]);
}
