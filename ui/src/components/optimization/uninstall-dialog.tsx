"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Undo2, Loader2, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import type { RestoreAvailabilityState } from "@/types/runtime";

type ResultMessage = {
  kind: "pending" | "success" | "warning" | "error";
  text: string;
};

interface UninstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availability: RestoreAvailabilityState;
  disabledReason?: string;
  onRefreshAvailability: () => Promise<RestoreAvailabilityState>;
  onComplete?: () => Promise<boolean>;
  onReturnFocus?: () => void;
}

export function UninstallDialog({ open, onOpenChange, availability, disabledReason, onRefreshAvailability, onComplete, onReturnFocus }: UninstallDialogProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<ResultMessage | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && loading) return;
    if (!nextOpen) setMessage(null);
    onOpenChange(nextOpen);
  };

  const handleUninstall = async () => {
    if (loading) return;
    setLoading(true);
    setMessage({ kind: "pending", text: "正在按记录倒序撤销全部优化…" });
    try {
      const res = await apiFetch("/api/uninstall", { method: "POST" });
      const d = await res.json() as { success?: boolean; code?: string };
      if (d.code === "NO_RESTORE_RECORD") {
        await onRefreshAvailability();
        setMessage({ kind: "warning", text: "尚无可撤销的优化记录。" });
        return;
      }
      if (!res.ok || !d.success) throw new Error(getMutationErrorMessage(res, "撤销未完成，请查看服务日志。"));
      let refreshed = true;
      try {
        refreshed = (await onComplete?.()) !== false;
      } catch {
        refreshed = false;
      }
      setMessage(refreshed
        ? { kind: "success", text: "所有尚未撤销的优化记录均已恢复，建议重启电脑。" }
        : { kind: "warning", text: "所有尚未撤销的优化记录均已恢复，但系统状态重新读取失败。请稍后选择“当前”重试。" });
    } catch (error) {
      setMessage({
        kind: "error",
        text: `撤销失败：${error instanceof Error ? error.message : "无法连接服务"}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!loading}
        onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus?.(); }}
        onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }}
        onInteractOutside={(event) => { if (loading) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="size-5 text-destructive" /> 撤销全部优化</DialogTitle>
          <DialogDescription>按时间倒序恢复所有尚未撤销的优化记录，不会删除本工具。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            系统设置将恢复为各次优化执行前记录的值，而不是 Windows 11 出厂默认值。
          </div>
          <Button variant="destructive" className="w-full justify-start gap-2" onClick={handleUninstall} disabled={loading || availability !== "available"} aria-describedby={disabledReason ? "uninstall-disabled-reason" : undefined}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}{loading ? "正在撤销" : "撤销全部优化"}
          </Button>
          {disabledReason && !message ? (
            <div id="uninstall-disabled-reason" className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
              {availability === "loading" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <Info className="mt-0.5 size-4 shrink-0" />}
              <span>{disabledReason}</span>
            </div>
          ) : null}
          {message ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-sm",
                message.kind === "pending" && "border-border bg-muted/50 text-muted-foreground",
                message.kind === "success" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                message.kind === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                message.kind === "error" && "border-destructive/20 bg-destructive/10 text-destructive",
              )}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.kind === "pending" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : null}
              {message.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : null}
              {message.kind === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : null}
              {message.kind === "error" ? <XCircle className="mt-0.5 size-4 shrink-0" /> : null}
              <span>{message.text}</span>
            </div>
          ) : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
