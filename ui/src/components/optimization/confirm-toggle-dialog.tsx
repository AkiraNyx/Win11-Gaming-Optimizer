"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { OptimizationItem, TransitionWarning } from "@/types/optimization";

interface ConfirmToggleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: OptimizationItem;
  currentLabel: string;
  targetLabel: string;
  warning: TransitionWarning;
  onConfirm: () => void;
  onReturnFocus?: () => void;
}

export function ConfirmToggleDialog({
  open,
  onOpenChange,
  item,
  currentLabel,
  targetLabel,
  warning,
  onConfirm,
  onReturnFocus,
}: ConfirmToggleDialogProps) {
  const isCommand = item.control === "command";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[440px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus?.();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isCommand ? `将「${item.name}」设为待执行？` : `将「${item.name}」调整为“${targetLabel}”？`}
          </DialogTitle>
          <DialogDescription>
            {isCommand
              ? "确认后仅更新执行计划，不会立即运行该操作。"
              : "确认后仅更新目标配置，不会立即修改系统。系统设置将在执行优化时更改。"}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 border-y border-border py-3 text-sm">
          <dt className="text-muted-foreground">{isCommand ? "当前计划" : "系统当前"}</dt>
          <dd className="font-medium">{currentLabel}</dd>
          <dt className="text-muted-foreground">{isCommand ? "执行计划" : "配置目标"}</dt>
          <dd className="font-medium">{targetLabel}</dd>
        </dl>

        <Alert className={warning.severity === "high" ? "border-destructive/30 bg-destructive/10" : "border-amber-500/30 bg-amber-500/10"}>
          <AlertDescription className={warning.severity === "high" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
            {warning.message}
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
          <Button
            variant={warning.severity === "high" ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {isCommand ? "设为待执行" : "确认调整"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
