"use client";
import { createContext, useContext, useId, useRef, type ComponentProps, type ReactNode, type SyntheticEvent } from "react";
import { Dialog as ArinoxDialog } from "@arinox/react";
import { Slot } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

const DialogContext = createContext<{ open: boolean; onOpenChange: (open: boolean) => void; titleId: string; descriptionId: string }>({ open: false, onOpenChange: () => {}, titleId: "", descriptionId: "" });
export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const id = useId();
  return <DialogContext.Provider value={{ open, onOpenChange, titleId: id + "-title", descriptionId: id + "-description" }}>{children}</DialogContext.Provider>;
}
export function DialogContent({ children, className, showCloseButton = true, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside }: {
  children: ReactNode; className?: string; showCloseButton?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onInteractOutside?: (event: SyntheticEvent<HTMLDialogElement>) => void;
}) {
  const { open, onOpenChange, titleId, descriptionId } = useContext(DialogContext);
  const closeRef = useRef<HTMLButtonElement>(null);
  return <ArinoxDialog open={open} onOpenChange={onOpenChange} initialFocusRef={closeRef}
    aria-labelledby={titleId} aria-describedby={descriptionId}
    className={cn("optimizer-dialog", className)} onCancel={onEscapeKeyDown}
    onAfterClose={() => onCloseAutoFocus?.(new Event("closeAutoFocus", { cancelable: true }))}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length > 0 && !node.closest("[inert]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
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
