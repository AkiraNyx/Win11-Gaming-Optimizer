"use client";

import { animate, createScope } from "animejs";
import { motionTokens, useReducedMotion } from "@arinox/react";
import { useLayoutEffect, useRef, useState, type ReactNode, type ComponentProps } from "react";

export function AnimatedCollapse({ open, children, className = "", onExited }: {
  open: boolean; children: ReactNode; className?: string; onExited?: () => void;
}) {
  const [retained, setRetained] = useState(open);
  const [content, setContent] = useState(children);
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef({ open, seen: false });
  const snapshot = useRef<{ height: number; opacity: number } | null>(null);
  const exited = useRef(onExited);
  const reduced = useReducedMotion();
  const present = open || retained;
  if (open && !retained) setRetained(true);
  if (open && content !== children) setContent(children);
  useLayoutEffect(() => { exited.current = onExited; }, [onExited]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !present) return;
    const first = !initial.current.seen;
    initial.current.seen = true;
    const full = element.firstElementChild?.getBoundingClientRect().height ?? element.scrollHeight;
    const from = snapshot.current ?? { height: first && !initial.current.open ? 0 : element.offsetHeight, opacity: first && !initial.current.open ? 0 : 1 };
    let active = true;
    const finish = () => {
      if (!active) return;
      element.dataset.motionState = open ? "open" : "closed";
      if (open) { element.style.height = "auto"; element.style.opacity = "1"; }
      else { setRetained(false); exited.current?.(); }
    };
    let animation: ReturnType<typeof animate> | undefined;
    element.dataset.motionState = open ? "opening" : "closing";
    const scope = createScope({ root: element }).add(() => {
      const tokens = motionTokens(element);
      animation = animate(element, {
        height: [from.height, open ? full : 0], opacity: [from.opacity, open ? 1 : 0],
        duration: tokens.base, ease: open ? tokens.enter : tokens.exit, onComplete: finish,
      });
      if (reduced || (first && initial.current.open)) animation.complete();
    });
    return () => {
      active = false;
      snapshot.current = { height: element.offsetHeight, opacity: Number(getComputedStyle(element).opacity) };
      animation?.cancel(); scope.revert();
    };
  }, [open, present, reduced]);
  return present ? <div ref={root} className={`optimizer-collapse ${className}`} inert={!open} aria-hidden={!open} data-expanded={open}>
    <div className="optimizer-collapse-content">{open ? children : content}</div>
  </div> : null;
}

function Scene({ active, direction, children, onExited }: { active: boolean; direction: number; children: ReactNode; onExited: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const saved = useRef<{ opacity: number; y: number } | null>(null);
  const exited = useRef(onExited);
  const reduced = useReducedMotion();
  useLayoutEffect(() => { exited.current = onExited; }, [onExited]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let live = true;
    element.dataset.motionState = active ? "opening" : "closing";
    const from = saved.current ?? { opacity: active ? 0 : 1, y: active ? direction * 8 : 0 };
    let animation: ReturnType<typeof animate> | undefined;
    const scope = createScope({ root: element }).add(() => {
      const tokens = motionTokens(element);
      animation = animate(element, {
        opacity: [from.opacity, active ? 1 : 0], translateY: [from.y, active ? 0 : -direction * 6],
        duration: active ? tokens.base : tokens.fast, ease: active ? tokens.enter : tokens.exit,
        onComplete: () => { if (!live) return; element.dataset.motionState = active ? "open" : "closed"; if (!active) exited.current(); },
      });
      if (reduced) animation.complete();
    });
    return () => {
      live = false;
      const style = getComputedStyle(element), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
      saved.current = { opacity: Number(style.opacity), y: matrix.f };
      animation?.cancel(); scope.revert();
    };
  }, [active, direction, reduced]);
  return <div ref={root} className={`optimizer-switch-scene${active ? "" : " is-leaving"}`} inert={!active} aria-hidden={!active} data-scene-active={active}>{children}</div>;
}

export function AnimatedSwitch({ identity, order, children }: { identity: string; order: number; children: ReactNode }) {
  const [view, setView] = useState({ identity, order, children, direction: 1, previous: null as { identity: string; children: ReactNode } | null });
  if (view.identity !== identity) setView({ identity, order, children, direction: order >= view.order ? 1 : -1, previous: { identity: view.identity, children: view.children } });
  else if (view.children !== children) setView({ ...view, children });
  return <div className="optimizer-content-switch">
    {view.previous && view.previous.identity !== identity ? <Scene key={view.previous.identity} active={false} direction={view.direction}
      onExited={() => setView(current => current.previous?.identity === view.previous?.identity ? { ...current, previous: null } : current)}>{view.previous.children}</Scene> : null}
    <Scene key={identity} active direction={view.direction} onExited={() => {}}>{children}</Scene>
  </div>;
}

export function AnimatedFade(props: ComponentProps<"div">) {
  return <Scene active direction={0} onExited={() => {}}><div {...props} /></Scene>;
}

export function AnimatedProgress({ value, className }: { value: number; className: string }) {
  const root = useRef<HTMLDivElement>(null), saved = useRef(0);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    let animation: ReturnType<typeof animate> | undefined;
    const scope = createScope({ root: node }).add(() => {
      const tokens = motionTokens(node);
      animation = animate(node, { width: [`${saved.current}%`, `${Math.max(0, Math.min(100, value))}%`], duration: tokens.base, ease: tokens.enter });
      if (reduced) animation.complete();
    });
    return () => {
      saved.current = node.parentElement?.clientWidth ? node.offsetWidth / node.parentElement.clientWidth * 100 : value;
      animation?.cancel(); scope.revert();
    };
  }, [value, reduced]);
  return <div ref={root} className={className} />;
}
