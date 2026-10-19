"use client";
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type SyntheticEvent } from "react";
import { Dialog as ArinoxDialog } from "@arinox/react";
import { Slot } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { useDialogMotion } from "@/hooks/use-dialog-motion";
import "./dialog-overlay.css";

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
function dialogControls(node: HTMLDialogElement) {
  return [...node.querySelectorAll<HTMLElement>(focusable)].filter(element => element.getClientRects().length > 0 && !element.closest("[inert],[hidden]"));
}

const DialogContext = createContext<{ open: boolean; onOpenChange: (open: boolean) => void; titleId: string; descriptionId: string }>({ open: false, onOpenChange: () => {}, titleId: "", descriptionId: "" });
export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const id = useId();
  return <DialogContext.Provider value={{ open, onOpenChange, titleId: id + "-title", descriptionId: id + "-description" }}>{children}</DialogContext.Provider>;
}
export function DialogContent({ children, className, showCloseButton = true, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, onAfterClose }: {
  children: ReactNode; className?: string; showCloseButton?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onInteractOutside?: (event: Event | SyntheticEvent<HTMLDialogElement>) => void;
  onAfterClose?: () => void;
}) {
  const { open, onOpenChange, titleId, descriptionId } = useContext(DialogContext);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [node, setNode] = useState<HTMLDialogElement | null>(null);
  useDialogMotion(node, open);
  const previous = useRef<HTMLElement | null>(null);
  const releaseBackground = useRef(() => {});
  const latest = useRef({ open, onOpenChange, onInteractOutside });
  useLayoutEffect(() => { latest.current = { open, onOpenChange, onInteractOutside }; });
  const attach = useCallback((element: HTMLDialogElement | null) => {
    if (element) previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNode(element);
  }, []);
  useLayoutEffect(() => {
    if (!node) return;
    const backdrop = document.createElement("div");
    backdrop.className = "optimizer-dialog-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    node.before(backdrop);
    const titlebar = document.querySelector<HTMLElement>(".optimizer-titlebar");
    const windowControls = document.querySelector(".optimizer-window-controls");
    const updateBoundary = () => {
      const top = windowControls ? titlebar?.getBoundingClientRect().bottom ?? 0 : 0;
      backdrop.style.top = `${top}px`;
      node.style.setProperty("--optimizer-dialog-top", `${top}px`);
    };
    updateBoundary();
    const resize = new ResizeObserver(updateBoundary);
    if (titlebar) resize.observe(titlebar);
    const inert = new Map<HTMLElement, boolean>();
    const isolate = (parent: HTMLElement) => {
      for (const child of parent.children) {
        if (!(child instanceof HTMLElement) || child === node || child === backdrop || child === windowControls) continue;
        if (child.contains(node) || (windowControls && child.contains(windowControls))) isolate(child);
        else { if (!inert.has(child)) inert.set(child, child.inert); child.inert = true; }
      }
    };
    isolate(document.body);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const [element, original] of inert) element.inert = original;
    };
    releaseBackground.current = release;
    const backgroundObserver = new MutationObserver(records => {
      if (!released && records.some(record => !node.contains(record.target) && !windowControls?.contains(record.target))) isolate(document.body);
    });
    backgroundObserver.observe(document.body, { childList: true, subtree: true });
    const phase = () => { backdrop.dataset.motionState = node.dataset.motionState; };
    phase();
    const observer = new MutationObserver(phase);
    observer.observe(node, { attributes: true, attributeFilter: ["data-motion-state"] });
    const focusDialog = () => (dialogControls(node)[0] ?? node).focus({ preventScroll: true });
    const keepFocus = (event: FocusEvent) => {
      if (!latest.current.open || node.contains(event.target as Node) || windowControls?.contains(event.target as Node)) return;
      focusDialog();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!node.open) return;
      if (event.key === "Escape") {
        if (node.querySelector("select:open")) return;
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.open) node.dispatchEvent(new Event("cancel", { cancelable: true }));
      } else if (event.key === "Tab") {
        const controls = dialogControls(node), first = controls[0], last = controls.at(-1);
        if (!latest.current.open || !first) { event.preventDefault(); if (latest.current.open) node.focus({ preventScroll: true }); }
        else if (document.activeElement === node || !node.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
      }
    };
    const outside = (event: PointerEvent) => {
      if (!latest.current.open) return;
      latest.current.onInteractOutside?.(event);
      if (!event.defaultPrevented) latest.current.onOpenChange(false);
    };
    backdrop.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", keepFocus);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      backgroundObserver.disconnect(); release(); resize.disconnect(); observer.disconnect(); backdrop.remove(); node.style.removeProperty("--optimizer-dialog-top");
      backdrop.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", keepFocus);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [node]);
  return <ArinoxDialog ref={attach} modal={false} aria-modal="true" open={open} onOpenChange={onOpenChange} initialFocusRef={closeRef}
    aria-labelledby={titleId} aria-describedby={descriptionId}
    className={cn("optimizer-dialog", className)} onCancel={onEscapeKeyDown}
    onAfterClose={() => {
      releaseBackground.current();
      const event = new Event("closeAutoFocus", { cancelable: true });
      onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && previous.current?.isConnected) previous.current.focus({ preventScroll: true });
      onAfterClose?.();
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
      onInteractOutside?.(event);
      if (!event.defaultPrevented) onOpenChange(false);
    }}>
    <div className="optimizer-dialog-body">
      {children}
      {showCloseButton && <Button ref={closeRef} variant="ghost" size="icon-sm" className="optimizer-dialog-close" aria-label="关闭" onClick={() => onOpenChange(false)}><X className="size-4" /></Button>}
    </div>
  </ArinoxDialog>;
}
export function DialogClose({ asChild, onClick, ...props }: ComponentProps<"button"> & { asChild?: boolean }) {
  const { onOpenChange } = useContext(DialogContext);
  const Comp = asChild ? Slot.Root : "button";
  return <Comp {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) onOpenChange(false); }} />;
}
export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("space-y-2 pr-6", className)} />;
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("optimizer-dialog-footer", className)} />;
}
export function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  const { titleId } = useContext(DialogContext);
  return <h2 {...props} id={titleId} className={cn("ax-display", className)} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  const { descriptionId } = useContext(DialogContext);
  return <p {...props} id={descriptionId} className={cn("text-sm leading-relaxed text-muted-foreground", className)} />;
}
