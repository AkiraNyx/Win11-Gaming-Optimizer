"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Shield, Loader2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import type { RestoreAvailabilityState } from "@/types/runtime";

type ResultMessage = {
  kind: "pending" | "success" | "warning" | "error";
  text: string;
};

interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availability: RestoreAvailabilityState;
  onRefreshAvailability: () => Promise<RestoreAvailabilityState>;
  onComplete?: () => Promise<boolean>;
  onReturnFocus?: () => void;
}

export function RestoreDialog({ open, onOpenChange, availability, onRefreshAvailability, onComplete, onReturnFocus }: RestoreDialogProps) {
  const [loadingMode, setLoadingMode] = useState<"latest" | "system" | null>(null);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [confirmSystemRestore, setConfirmSystemRestore] = useState(false);
  const loading = loadingMode !== null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && loading) return;
    if (!nextOpen) {
      setMessage(null);
      setConfirmSystemRestore(false);
    }
    onOpenChange(nextOpen);
  };

  const handleRestore = async (mode: "latest" | "system") => {
    if (loading) return;
    setConfirmSystemRestore(false);
    setLoadingMode(mode);
    setMessage({
      kind: "pending",
      text: mode === "system" ? "正在启动 Windows 系统还原…" : "正在恢复最近一次优化前的设置…",
    });
    try {
      const res = await apiFetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "system" ? { useSystemRestore: true } : {}) });
      const d = await res.json() as { success?: boolean; code?: string };
      if (d.code === "NO_RESTORE_RECORD") {
        await onRefreshAvailability();
        setMessage({ kind: "warning", text: "尚无可恢复的优化记录。请先执行优化，再尝试恢复。" });
        return;
      }
      if (!res.ok || !d.success) throw new Error(getMutationErrorMessage(res, "恢复未完成，请查看服务日志。"));
      let refreshed = true;
      try {
        refreshed = (await onComplete?.()) !== false;
      } catch {
        refreshed = false;
      }
      const completedText = mode === "system"
        ? "Windows 系统还原已启动，请按系统提示重启电脑完成。"
        : "最近一次优化记录已恢复，建议重启电脑。";
      const refreshWarning = mode === "system"
        ? "Windows 系统还原已启动，但系统状态重新读取失败。请按系统提示完成还原，并在之后选择“当前”重试。"
        : "最近一次优化记录已恢复，但系统状态重新读取失败。请稍后选择“当前”重试。";
      setMessage(refreshed
        ? { kind: "success", text: completedText }
        : { kind: "warning", text: refreshWarning });
    } catch (error) {
      setMessage({
        kind: "error",
        text: `恢复失败：${error instanceof Error ? error.message : "无法连接服务"}`,
      });
    } finally {
      setLoadingMode(null);
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
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="size-5" /> 恢复设置</DialogTitle>
          <DialogDescription>“恢复最近一次”仅回滚本工具该次记录；“Windows 系统还原”会回退范围更广的系统状态。两者都不会删除本工具，也不会恢复出厂设置。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" aria-busy={loading}>
          {confirmSystemRestore ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>Windows 可能回退还原点之后安装的应用、驱动、系统更新和其他系统设置。此操作不限于本工具的优化记录，通常需要重启。</span>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setConfirmSystemRestore(false)}>返回</Button>
                <Button variant="destructive" onClick={() => { void handleRestore("system"); }}>确认启动系统还原</Button>
              </div>
            </div>
          ) : (
            <>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => { void handleRestore("latest"); }} disabled={loading || availability !== "available"}>
                {loadingMode === "latest" || availability === "loading" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}恢复最近一次优化前设置
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => { setMessage(null); setConfirmSystemRestore(true); }} disabled={loading}>
                {loadingMode === "system" ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}使用本工具的系统还原点
              </Button>
            </>
          )}
          {availability === "loading" ? (
            <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
              <span>正在检查可恢复记录…</span>
            </div>
          ) : null}
          {availability === "empty" ? (
            <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>尚无可恢复的优化记录。执行优化后，可在此恢复优化前的设置。</span>
            </div>
          ) : null}
          {availability === "error" ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>无法检查可恢复记录。请稍后重试。</span>
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
