"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";

interface ExecutionStatus {
  operation: string | null;
  running: boolean;
  phase: string;
  log: string[];
}

interface RuntimeLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus?: () => void;
}

const OPERATION_LABELS: Record<string, string> = {
  optimize: "执行优化",
  restore: "恢复设置",
  uninstall: "撤销优化",
  backup: "创建备份",
};

function getLogLineClass(line: string) {
  if (line.includes("[ERR]") || line.includes("[ERROR]")) return "text-red-400";
  if (line.includes("[WARN]")) return "text-amber-300";
  if (line.includes("[OK]") || line.includes("[SUCCESS]")) return "text-emerald-400";
  return "text-gray-300";
}

export function RuntimeLogDialog({ open, onOpenChange, onReturnFocus }: RuntimeLogDialogProps) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const followLogRef = useRef(true);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    let requestInFlight = false;
    let loaded = false;
    followLogRef.current = true;
    setStatus(null);
    setLoading(true);
    setError("");

    const load = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await apiFetch("/api/status", { signal: controller.signal });
        if (!response.ok) throw new Error("Status API unavailable");
        const nextStatus = await response.json() as ExecutionStatus;
        setStatus(nextStatus);
        setError("");
      } catch (loadError) {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("无法读取运行日志，请稍后重试。");
        }
      } finally {
        requestInFlight = false;
        if (!loaded) {
          loaded = true;
          setLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => { void load(); }, 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [open]);

  const operationLabel = status?.operation
    ? OPERATION_LABELS[status.operation] ?? status.operation
    : "尚无系统操作";
  const log = status?.log ?? [];
  const stateLabel = status?.running ? "进行中" : status?.phase === "error" ? "执行出错" : "已完成";
  const logLength = log.length;

  useEffect(() => {
    const logElement = logRef.current;
    if (logElement && followLogRef.current) logElement.scrollTop = logElement.scrollHeight;
  }, [logLength]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="min-w-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus?.(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Terminal className="size-5" />运行日志</DialogTitle>
          <DialogDescription>显示本次服务启动后最近一次系统操作的输出。</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-muted-foreground">最近操作：<span className="text-foreground">{operationLabel}</span></span>
            {status?.operation ? <Badge variant={status.phase === "error" ? "destructive" : "outline"}>{stateLabel}</Badge> : null}
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          <div
            ref={logRef}
            className="h-[min(22rem,50dvh)] min-w-0 overflow-x-hidden overflow-y-auto rounded-md border bg-black/50 p-3 font-mono text-xs"
            role="log"
            aria-label="运行日志内容"
            aria-busy={loading}
            onScroll={(event) => {
              const logElement = event.currentTarget;
              followLogRef.current = logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight < 24;
            }}
          >
            {log.map((line, index) => (
              <div key={index} className={`whitespace-pre-wrap wrap-break-word ${getLogLineClass(line)}`}>{line}</div>
            ))}
            {loading ? <div className="flex items-center gap-1 text-gray-300"><Loader2 className="size-3 animate-spin" />正在读取日志…</div> : null}
            {!loading && !error && log.length === 0 ? <div className="text-gray-400">当前服务尚无运行日志。</div> : null}
            {status?.running ? <div className="flex items-center gap-1 text-primary"><Loader2 className="size-3 animate-spin" />操作仍在进行…</div> : null}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
