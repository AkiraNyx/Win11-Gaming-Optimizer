"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Download } from "lucide-react";

interface ExportDialogProps { open: boolean; onOpenChange: (open: boolean) => void; jsonContent: string; onReturnFocus?: () => void; }

export function ExportDialog({ open, onOpenChange, jsonContent, onReturnFocus }: ExportDialogProps) {
  const [feedback, setFeedback] = useState<{ payload: string; status: "copied" | "error" } | null>(null);
  const copyVersionRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copied = open && feedback?.payload === jsonContent && feedback.status === "copied";
  const copyError = open && feedback?.payload === jsonContent && feedback.status === "error";
  const cancelCopy = useCallback(() => {
    copyVersionRef.current++;
    clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    setFeedback(null);
    return cancelCopy;
  }, [open, jsonContent, cancelCopy]);

  const handleCopy = async () => {
    cancelCopy();
    const copyVersion = copyVersionRef.current;
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(jsonContent);
      if (copyVersion !== copyVersionRef.current) return;
      setFeedback({ payload: jsonContent, status: "copied" });
      copyTimerRef.current = setTimeout(() => setFeedback(null), 2000);
    } catch {
      if (copyVersion === copyVersionRef.current) setFeedback({ payload: jsonContent, status: "error" });
    }
  };
  const handleDownload = () => {
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `win11-optimizer-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus?.(); }}>
        <DialogHeader>
          <DialogTitle>导出配置</DialogTitle>
          <DialogDescription>复制配置内容或下载 JSON 文件。</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded-md border bg-muted/50 p-3">
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{jsonContent}</pre>
        </div>
        {copyError ? <p role="alert" className="text-xs text-destructive">无法访问剪贴板，请下载 JSON 文件。</p> : null}
        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">关闭</Button></DialogClose>
          <Button variant="outline" onClick={() => { void handleCopy(); }}>{copied ? <><Check className="size-4" />已复制</> : "复制到剪贴板"}</Button>
          <Button onClick={handleDownload}><Download className="mr-1.5 size-3.5" />下载 JSON</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
