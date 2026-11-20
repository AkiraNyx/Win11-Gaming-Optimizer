"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Trash2, XCircle } from "lucide-react";
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
  result: { exitCode: number; cleanup?: CleanupApply; interrupted?: boolean } | null;
}

/**
 * "unknown" is its own state on purpose: when the start request is lost or the
 * result cannot be parsed, the cleanup may already have run. Reporting "failed"
 * (nothing happened) or "done" (everything was cleaned) would both be wrong.
 */
type Stage = "confirm" | "running" | "done" | "stale" | "failed" | "unknown";

const TITLES: Record<Stage, string> = {
  confirm: "清理选中的位置？",
  running: "正在清理",
  done: "清理完成",
  stale: "预览已过期",
  failed: "清理未完成",
  unknown: "结果未知",
};

const DESCRIPTIONS: Record<Stage, string> = {
  confirm: "以下位置的内容将被删除，操作不可撤销，也不会写入优化回滚记录。",
  running: "正在删除文件，请勿关闭程序。被占用的文件会留在原处并计入失败项。",
  done: "已删除的内容无法通过“恢复”找回。",
  stale: "预览之后有位置发生了变化，本次只处理了确认过的清单，剩余部分需要重新扫描。",
  failed: "清理没有开始，或没有删除任何文件。",
  unknown: "无法确认清理是否已经开始、是否完成，请重新扫描查看当前占用。",
};

interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: CleanupTarget[];
  olderThanDays: number;
  planId: string;
  onComplete?: () => Promise<boolean>;
  onReturnFocus?: () => void;
}

export function CleanupDialog({
  open,
  onOpenChange,
  targets,
  olderThanDays,
  planId,
  onComplete,
  onReturnFocus,
}: CleanupDialogProps) {
  const [stage, setStage] = useState<Stage>("confirm");
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [result, setResult] = useState<CleanupApply | null>(null);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [wholeConfirmed, setWholeConfirmed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const pollFailureCountRef = useRef(0);
  const completionNotifiedRef = useRef(false);

  const totalBytes = targets.reduce((sum, target) => sum + target.bytes, 0);
  // Targets that are cleared as a whole (the recycle bin) also remove entries
  // created after the preview, so they need their own confirmation.
  const wholeTargets = targets.filter((target) => target.wholeTarget);
  useWindowCloseBlock(open && stage === "running");

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const refreshAfterRun = useCallback(async () => {
    if (completionNotifiedRef.current) return;
    completionNotifiedRef.current = true;
    try {
      const refreshed = await onComplete?.();
      setRefreshWarning(refreshed === false);
    } catch {
      setRefreshWarning(true);
    }
  }, [onComplete]);

  const pollStatus = useCallback(async () => {
    if (pollInFlightRef.current) return;
    const operationId = operationIdRef.current;
    if (!operationId) return;
    pollInFlightRef.current = true;
    try {
      const response = await apiFetch(`/api/status?operationId=${encodeURIComponent(operationId)}`);
      if (response.status === 409) {
        stopPolling();
        setStage("unknown");
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
        const cleanup = nextStatus.result.cleanup ?? null;
        if (!cleanup || !Array.isArray(cleanup.results)) {
          setStage("unknown");
          setError("清理进程已结束，但没有收到可解析的结果。");
          await refreshAfterRun();
          return;
        }
        setResult(cleanup);
        const stale = cleanup.results.some((item) => item.status === "stale");
        setStage(stale ? "stale" : "done");
        await refreshAfterRun();
      } else if (nextStatus.result?.interrupted === true) {
        // Files are deleted one by one, so a timeout or a crashed process may
        // already have removed part of the selection.
        setStage("unknown");
        setError("清理进程在完成前结束，可能已经删除了部分文件。请重新扫描确认当前占用。");
        await refreshAfterRun();
      } else {
        setStage("failed");
        setError(nextStatus.message || "清理未能完成，请查看运行日志。");
        await refreshAfterRun();
      }
    } catch {
      pollFailureCountRef.current += 1;
      if (pollFailureCountRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
        stopPolling();
        setStage("unknown");
        setError("状态连接持续中断，无法确认本次清理的结果。请重新扫描。");
        await refreshAfterRun();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [refreshAfterRun, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollStatus();
    intervalRef.current = setInterval(() => void pollStatus(), 1000);
  }, [pollStatus, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

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
    setWholeConfirmed(false);
  }, [open, stopPolling]);

  const startCleanup = async () => {
    if (targets.length === 0) return;
    setStage("running");
    setError("");
    setStatus(null);
    setResult(null);

    let response: Response;
    try {
      response = await apiFetch("/api/cleanup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((target) => target.id),
          olderThanDays,
          planId,
        }),
      });
    } catch {
      // The request never completed: it may or may not have reached the server.
      setStage("unknown");
      setError("请求未能完成，无法确认清理是否已开始。请重新扫描查看当前占用。");
      return;
    }

    if (response.status === 400) {
      setStage("failed");
      setError("请求内容无效，预览可能已经刷新，请重新扫描后再清理。");
      return;
    }
    if (!response.ok) {
      setStage("failed");
      setError(getMutationErrorMessage(response, "无法启动清理操作。"));
      return;
    }

    let payload: { operationId?: string };
    try {
      payload = await response.json() as { operationId?: string };
    } catch {
      setStage("unknown");
      setError("服务响应无法解析，无法确认清理是否已开始。");
      return;
    }
    if (!payload.operationId) {
      setStage("unknown");
      setError("服务未返回操作标识，无法跟踪清理进度，也无法确认是否已开始。");
      return;
    }

    operationIdRef.current = payload.operationId;
    startPolling();
  };

  const running = stage === "running";
  const progress = status?.progress ?? 5;
  const staleCount = result?.results.filter((item) => item.status === "stale").length ?? 0;
  const failedItems = result?.results.filter((item) => item.status !== "ok" && item.status !== "skipped") ?? [];

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
          <DialogTitle>{TITLES[stage]}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[stage]}</DialogDescription>
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
              浏览器缓存、开发工具缓存等位置删除后无法恢复；预览之后新增的文件不会被删除，过期清单需要重新扫描。
            </p>
            {wholeTargets.length > 0 ? (
              <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0"
                  checked={wholeConfirmed}
                  onChange={(event) => setWholeConfirmed(event.target.checked)}
                />
                <span>
                  我确认清空整个回收站：该位置按“整个清空”执行，
                  <strong>预览之后新移入回收站的文件也会被永久删除</strong>，且无法恢复。
                </span>
              </label>
            ) : null}
          </>
        ) : null}

        {stage === "running" ? (
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

        {(stage === "done" || stage === "stale") && result ? (
          <div className="space-y-3">
            <div className="cleanup-result-grid">
              <div><span>释放空间</span><strong>{formatBytes(result.freedBytes)}</strong></div>
              <div><span>删除文件</span><strong>{formatCount(result.removedFiles)}</strong></div>
              <div><span>失败位置</span><strong>{result.failureCount + staleCount}</strong></div>
            </div>
            {failedItems.length > 0 ? (
              <ul className="cleanup-dialog-list">
                {failedItems.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <span className="truncate">{item.id}</span>
                    <span className="cleanup-entry-size">
                      {item.status === "stale" ? "预览已过期" : item.reason || "部分文件删除失败"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {stage === "stale" ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                有 {staleCount} 个位置的预览清单已失效，这些位置没有删除任何文件。重新扫描后可以再清理。
              </p>
            ) : null}
            {refreshWarning ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                清理已结束，但重新扫描失败，列表中的大小可能不是最新值。
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

        {stage === "unknown" ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300" role="alert">
            <AlertTriangle className="size-4 shrink-0" />
            {error || "无法确认本次清理的结果，请重新扫描。"}
          </p>
        ) : null}

        <DialogFooter>
          {stage === "confirm" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button
                variant="destructive"
                onClick={() => void startCleanup()}
                disabled={targets.length === 0 || !planId || (wholeTargets.length > 0 && !wholeConfirmed)}
              >
                <Trash2 className="size-4" />确认清理 {formatBytes(totalBytes)}
              </Button>
            </>
          ) : null}
          {stage === "running" ? (
            <Button variant="outline" disabled>
              <Loader2 className="size-4 animate-spin" />正在清理
            </Button>
          ) : null}
          {stage === "stale" || stage === "unknown" ? (
            <Button
              onClick={() => { void refreshAfterRun(); onOpenChange(false); }}
            >
              <RotateCcw className="size-4" />重新扫描
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
