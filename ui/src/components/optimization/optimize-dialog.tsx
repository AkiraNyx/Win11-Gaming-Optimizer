import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Play, CheckCircle, XCircle, Loader2, Terminal, RotateCcw } from "lucide-react";
import type { PresetConfig, PresetLevel } from "@/types/optimization";
import type { HardwareInfo } from "@/types/hardware";
import { useSnapshotHistory } from "@/hooks/use-snapshot-history";
import { apiFetch } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/api-errors";

const MAX_CONSECUTIVE_POLL_FAILURES = 10;

interface ExecutionStatus {
  operationId: string | null;
  operation: string | null;
  running: boolean;
  phase: string;
  progress: number;
  message: string;
  log: string[];
  result: { exitCode: number; configFile?: string } | null;
}

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: PresetConfig;
  preset: PresetLevel;
  hardware: HardwareInfo;
  onComplete?: () => Promise<boolean>;
  onReturnFocus?: () => void;
}

export function OptimizeDialog({
  open,
  onOpenChange,
  config,
  preset,
  hardware,
  onComplete,
  onReturnFocus,
}: OptimizeDialogProps) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [snapshotWarning, setSnapshotWarning] = useState(false);
  const [restartConfirmation, setRestartConfirmation] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const followLogRef = useRef(true);
  const pollInFlightRef = useRef(false);
  const startingRef = useRef(false);
  const completionNotifiedRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const pollFailureCountRef = useRef(0);
  const { saveSnapshot } = useSnapshotHistory();

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
        setError("本次优化的状态已失效，无法确认执行结果。");
        setStatus((previous) => previous ? {
          ...previous,
          running: false,
          phase: "unknown",
          message: "无法确认本次优化的最终状态",
          result: null,
        } : previous);
        return;
      }
      if (!response.ok) throw new Error("Status API unavailable");
      const nextStatus = await response.json() as ExecutionStatus;
      if (nextStatus.operationId !== operationId || nextStatus.operation !== "optimize") return;
      pollFailureCountRef.current = 0;
      setStatus(nextStatus);
      setError("");
      if (!nextStatus.running) {
        stopPolling();
        if (
          nextStatus.phase === "done"
          && nextStatus.result?.exitCode === 0
          && !completionNotifiedRef.current
        ) {
          completionNotifiedRef.current = true;
          setFinalizing(true);
          try {
            const refreshed = await onComplete?.();
            setRefreshWarning(refreshed === false);
          } catch {
            setRefreshWarning(true);
          } finally {
            setFinalizing(false);
          }
        }
      }
    } catch {
      pollFailureCountRef.current += 1;
      if (pollFailureCountRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
        stopPolling();
        setError("状态连接持续中断，无法确认本次优化的执行结果。");
        setStatus((previous) => previous ? {
          ...previous,
          running: false,
          phase: "unknown",
          message: "无法确认本次优化的最终状态",
          result: null,
        } : previous);
      } else {
        setError("状态连接中断，正在重试…");
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

  const logLength = status?.log.length ?? 0;
  useEffect(() => {
    const log = logRef.current;
    if (log && followLogRef.current) log.scrollTop = log.scrollHeight;
  }, [logLength]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (status?.running || startingRef.current || restarting || finalizing)) return;
    if (!nextOpen && !status?.running && !startingRef.current) {
      stopPolling();
      setStatus(null);
      setError("");
      setRefreshWarning(false);
      setSnapshotWarning(false);
      setRestartConfirmation(false);
      setFinalizing(false);
      operationIdRef.current = null;
      followLogRef.current = true;
      pollFailureCountRef.current = 0;
      completionNotifiedRef.current = false;
    }
    onOpenChange(nextOpen);
  };

  const start = async (skipSnapshot = false) => {
    if (startingRef.current || status?.running) return;
    startingRef.current = true;
    completionNotifiedRef.current = false;
    pollFailureCountRef.current = 0;
    followLogRef.current = true;
    stopPolling();
    setError("");
    setRefreshWarning(false);
    setSnapshotWarning(false);
    const operationId = crypto.randomUUID();
    operationIdRef.current = operationId;
    setStatus({
      operationId,
      operation: "optimize",
      running: true,
      phase: "starting",
      progress: 0,
      message: "正在保存优化前快照…",
      log: [],
      result: null,
    });

    try {
      if (!skipSnapshot && !(await saveSnapshot(config, preset, hardware))) {
        setStatus(null);
        setSnapshotWarning(true);
        return;
      }

      setStatus({
        operationId,
        operation: "optimize",
        running: true,
        phase: "starting",
        progress: 5,
        message: "正在启动优化…",
        log: [],
        result: null,
      });
      const response = await apiFetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, operationId }),
      });
      if (!response.ok) {
        let message = "无法启动优化";
        try {
          const data = await response.json() as { error?: string };
          if (data.error) message = getMutationErrorMessage(response, "无法启动优化，请查看服务日志。");
        } catch {
          // Keep the fallback message for non-JSON failures.
        }
        setError(message);
        operationIdRef.current = null;
        setStatus(null);
        return;
      }
      const data = await response.json() as { operationId?: string };
      if (data.operationId !== operationId) throw new Error("服务端返回了无效的操作标识");
      startPolling();
    } catch {
      setError("优化启动响应中断，正在确认执行状态…");
      startPolling();
    } finally {
      startingRef.current = false;
    }
  };

  const isDone = !!status && !status.running && (status.phase === "done" || status.phase === "error");
  const resultUnknown = !!status && !status.running && status.phase === "unknown";
  const isSettled = isDone || resultUnknown;
  const ok = isDone && status.result?.exitCode === 0;
  const hasWarnings = !!status?.log.some((line) => line.includes("[WARN]"));
  const completedWithWarnings = ok && hasWarnings;

  const requestRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    setError("");
    try {
      const response = await apiFetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: true }),
      });
      if (!response.ok) throw new Error("无法安排重启");
      setRestartConfirmation(false);
      setStatus((previous) => previous ? { ...previous, message: "已安排在 5 秒后重启电脑。" } : previous);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : "无法安排重启");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="min-w-0 sm:max-w-lg"
        showCloseButton={!status?.running && !restarting && !finalizing}
        onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus?.(); }}
        onEscapeKeyDown={(event) => { if (status?.running || restarting || finalizing) event.preventDefault(); }}
        onInteractOutside={(event) => { if (status?.running || restarting || finalizing) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Terminal className="size-5" /> 执行优化</DialogTitle>
          <DialogDescription>使用当前配置执行优化，并在执行前保存配置快照。</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4" aria-live="polite">
          {error ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          {snapshotWarning ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>无法保存优化前配置快照。继续执行后，应用内将缺少这份配置记录；执行脚本仍会在写入前尝试创建系统变更日志。</span>
            </div>
          ) : null}
          {restartConfirmation ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>确认后，Windows 将在 5 秒后重启。请先保存其他应用中的工作。</span>
            </div>
          ) : null}
          {status && (
            <div className="min-w-0 space-y-3">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{status.message}</span><span className="font-mono">{status.progress}%</span></div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={status.progress}
                  aria-label="优化进度"
                >
                  <motion.div className={"h-full rounded-full " + (completedWithWarnings ? "bg-amber-500" : ok ? "bg-emerald-500" : status.phase === "error" ? "bg-destructive" : "bg-primary")} initial={{ width: 0 }} animate={{ width: status.progress + "%" }} />
                </div>
              </div>
              <div
                ref={logRef}
                className="h-48 min-w-0 overflow-x-hidden overflow-y-auto rounded-md border bg-black/50 p-3 font-mono text-xs"
                role="log"
                aria-label="优化日志"
                onScroll={(event) => {
                  const log = event.currentTarget;
                  followLogRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
                }}
              >
                {status.log.map((line, index) => (
                  <div
                    key={index}
                    className={(line.includes("[ERR]") || line.includes("[ERROR]")) ? "whitespace-pre-wrap wrap-break-word text-red-400" : line.includes("[WARN]") ? "whitespace-pre-wrap wrap-break-word text-amber-300" : line.includes("[OK]") ? "whitespace-pre-wrap wrap-break-word text-emerald-400" : "whitespace-pre-wrap wrap-break-word text-gray-300"}
                  >
                    {line}
                  </div>
                ))}
                {status.running && <div className="flex items-center gap-1 text-primary"><Loader2 className="size-3 animate-spin" /> 处理中…</div>}
              </div>
              {finalizing ? <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />正在重新读取系统状态…</div> : null}
              {isDone ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={"flex items-center gap-2 rounded-md border p-3 text-sm " + (completedWithWarnings ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/20 bg-destructive/10 text-destructive")}
                  role={ok ? "status" : "alert"}
                >
                  {completedWithWarnings ? <><AlertTriangle className="size-4" /> 优化完成，但有警告。请查看日志，部分调整可能需要重启电脑后生效。</> : ok ? <><CheckCircle className="size-4" /> 优化完成，建议重启电脑。</> : <><XCircle className="size-4" /> 执行出错，请查看日志。</>}
                </motion.div>
              ) : null}
              {refreshWarning ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>优化已完成，但系统状态重新读取失败。请稍后选择“当前”重试。</span>
                </div>
              ) : null}
              {resultUnknown ? <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />执行结果未知。请等待后台操作结束，并重新读取系统状态后再继续。</div> : null}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {(!status || isSettled) && !restartConfirmation ? <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={restarting || finalizing}>{isSettled ? "关闭" : "取消"}</Button> : null}
          {!status && !snapshotWarning ? <Button onClick={() => { void start(); }} className="gap-1.5"><Play className="size-3.5" /> 开始优化</Button> : null}
          {!status && snapshotWarning ? <Button variant="destructive" onClick={() => { void start(true); }} className="gap-1.5"><Play className="size-3.5" /> 不保存快照，继续优化</Button> : null}
          {isDone && ok && !restartConfirmation ? <Button variant="outline" onClick={() => setRestartConfirmation(true)} className="gap-1.5" disabled={finalizing}><RotateCcw className="size-3.5" /> 重启电脑</Button> : null}
          {restartConfirmation ? <Button variant="outline" onClick={() => setRestartConfirmation(false)} disabled={restarting || finalizing}>取消</Button> : null}
          {restartConfirmation ? <Button variant="destructive" onClick={() => { void requestRestart(); }} disabled={restarting || finalizing}>{restarting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{restarting ? "正在安排重启" : "确认重启"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
