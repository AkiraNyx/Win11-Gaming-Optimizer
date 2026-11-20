"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";
import { AnimatedProgress } from "@/components/ui/animated-region";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWindowCloseBlock } from "@/hooks/use-window-close-block";
import { apiFetch } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/api-errors";
import { formatBytes, formatCount } from "@/lib/cleanup";
import type { CleanupApply, CleanupTarget } from "@/types/cleanup";

const MAX_CONSECUTIVE_POLL_FAILURES = 10;

interface ExecutionStatus {
  operationId: string | null;
  operation: string | null;
  running: boolean;
  phase: string;
  progress: number;
  message: string;
  log: string[];
  result: { exitCode: number; cleanup?: CleanupApply } | null;
}

type Stage = "confirm" | "running" | "done" | "failed";

interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: CleanupTarget[];
  olderThanDays: number;
  onComplete?: () => Promise<boolean>;
  onReturnFocus?: () => void;
}

export function CleanupDialog({
  open,
  onOpenChange,
  targets,
  olderThanDays,
  onComplete,
  onReturnFocus,
}: CleanupDialogProps) {
  const [stage, setStage] = useState<Stage>("confirm");
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [result, setResult] = useState<CleanupApply | null>(null);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const pollFailureCountRef = useRef(0);
  const completionNotifiedRef = useRef(false);

  const totalBytes = targets.reduce((sum, target) => sum + target.bytes, 0);
  useWindowCloseBlock(open && stage === "running");

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    if (pollInFlightRef.current) return;
    const operationId = operationIdRef.current;
    if (!operationId) return;
    pollInFlightRef.current = true;
    try {
      const response = await apiFetch(`/api/status?operationId=${encodeURIComponent(operationId)}`);
      if (response.status === 409) {
        stopPolling();
        setStage("failed");
        setError("本次清理的状态已失效，无法确认执行结果。");
        return;
      }
      if (!response.ok) throw new Error("Status API unavailable");
      const nextStatus = await response.json() as ExecutionStatus;
      if (nextStatus.operationId !== operationId || nextStatus.operation !== "cleanup") return;
      pollFailureCountRef.current = 0;
      setStatus(nextStatus);
      if (nextStatus.running) return;

      stopPolling();
      if (nextStatus.phase === "done" && nextStatus.result?.exitCode === 0) {
        setResult(nextStatus.result.cleanup ?? null);
        setStage("done");
        if (!completionNotifiedRef.current) {
          completionNotifiedRef.current = true;
          try {
            const refreshed = await onComplete?.();
            setRefreshWarning(refreshed === false);
          } catch {
            setRefreshWarning(true);
          }
        }
      } else {
        setStage("failed");
        setError(nextStatus.message || "清理未能完成，请查看运行日志。");
      }
    } catch {
      pollFailureCountRef.current += 1;
      if (pollFailureCountRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
        stopPolling();
        setStage("failed");
        setError("状态连接持续中断，无法确认本次清理的结果。请查看运行日志。");
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [onComplete, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollStatus();
    intervalRef.current = setInterval(() => void pollStatus(), 1000);
  }, [pollStatus, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Reset every time the dialog is opened so a previous result never leaks in.
  useEffect(() => {
    if (open) return;
    stopPolling();
    operationIdRef.current = null;
    completionNotifiedRef.current = false;
    pollFailureCountRef.current = 0;
    setStage("confirm");
    setStatus(null);
    setResult(null);
    setError("");
    setRefreshWarning(false);
  }, [open, stopPolling]);

  const startCleanup = async () => {
    if (targets.length === 0) return;
    setStage("running");
    setError("");
    setStatus(null);
    try {
      const response = await apiFetch("/api/cleanup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((target) => target.id),
          olderThanDays,
        }),
      });
      if (!response.ok) {
        setStage("failed");
        setError(getMutationErrorMessage(response, "无法启动清理操作。"));
        return;
      }
      const payload = await response.json() as { operationId?: string };
      if (!payload.operationId) {
        setStage("failed");
        setError("服务未返回操作标识，无法跟踪清理进度。");
        return;
      }
      operationIdRef.current = payload.operationId;
      startPolling();
    } catch {
      setStage("failed");
      setError("无法连接到本地服务，清理未开始。");
    }
  };

  const running = stage === "running";
  const progress = status?.progress ?? 5;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next); }}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (onReturnFocus) {
            onReturnFocus();
            return;
          }
          (document.querySelector("[data-cleanup-apply]") as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {stage === "confirm" ? "清理选中的位置？" : stage === "running" ? "正在清理" : stage === "done" ? "清理完成" : "清理未完成"}
          </DialogTitle>
          <DialogDescription>
            {stage === "confirm"
              ? "以下位置的内容将被删除，操作不可撤销，也不会写入优化回滚记录。"
              : stage === "running"
                ? "正在删除文件，请勿关闭程序。被占用的文件会留在原处并计入失败项。"
                : stage === "done"
                  ? "已删除的内容无法通过“恢复”找回。"
                  : "本次清理没有完全成功，已删除的内容不会自动恢复。"}
          </DialogDescription>
        </DialogHeader>

        {stage === "confirm" ? (
          <>
            <div className="cleanup-dialog-summary">
              <span>将清理 {targets.length} 个位置</span>
              <strong>{formatBytes(totalBytes)}</strong>
            </div>
            <ul className="cleanup-dialog-list">
              {targets.slice(0, 10).map((target) => (
                <li key={target.id}>
                  <span className="truncate">{target.label}</span>
                  <span className="cleanup-entry-size">{formatBytes(target.bytes)}</span>
                </li>
              ))}
              {targets.length > 10 ? <li className="cleanup-entry-more">另有 {targets.length - 10} 个位置</li> : null}
            </ul>
            <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              回收站、浏览器缓存等位置删除后无法恢复；正在被程序占用的文件会被跳过。
            </p>
          </>
        ) : null}

        {stage === "running" || (stage === "done" && !result) ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{status?.message || "正在启动清理…"}</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="清理进度"
            >
              <AnimatedProgress className="h-full rounded-full bg-primary" value={progress} />
            </div>
          </div>
        ) : null}

        {stage === "done" && result ? (
          <div className="space-y-3">
            <div className="cleanup-result-grid">
              <div><span>释放空间</span><strong>{formatBytes(result.freedBytes)}</strong></div>
              <div><span>删除文件</span><strong>{formatCount(result.removedFiles)}</strong></div>
              <div><span>失败位置</span><strong>{result.failureCount}</strong></div>
            </div>
            {result.results.filter((item) => item.status !== "ok").length > 0 ? (
              <ul className="cleanup-dialog-list">
                {result.results
                  .filter((item) => item.status !== "ok")
                  .slice(0, 8)
                  .map((item) => (
                    <li key={item.id}>
                      <span className="truncate">{item.id}</span>
                      <span className="cleanup-entry-size">{item.status === "skipped" ? item.reason : item.reason || "部分删除失败"}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
            {refreshWarning ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                清理已完成，但重新扫描失败，列表中的大小可能不是最新值。
              </p>
            ) : null}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0" />
              这次删除不会进入“恢复”流程；可重新扫描查看当前占用。
            </p>
          </div>
        ) : null}

        {stage === "failed" ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
            <XCircle className="size-4 shrink-0" />
            {error || "清理未能完成。"}
          </p>
        ) : null}

        <DialogFooter>
          {stage === "confirm" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button variant="destructive" onClick={() => void startCleanup()} disabled={targets.length === 0}>
                <Trash2 className="size-4" />确认清理 {formatBytes(totalBytes)}
              </Button>
            </>
          ) : null}
          {stage === "running" ? (
            <Button variant="outline" disabled>
              <Loader2 className="size-4 animate-spin" />正在清理
            </Button>
          ) : null}
          {stage === "done" || stage === "failed" ? (
            <Button onClick={() => onOpenChange(false)}>关闭</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
