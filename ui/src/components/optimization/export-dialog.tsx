"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Download } from "lucide-react";

interface ExportDialogProps { open: boolean; onOpenChange: (open: boolean) => void; jsonContent: string; onReturnFocus?: () => void; }

export function ExportDialog({ open, onOpenChange, jsonContent, onReturnFocus }: ExportDialogProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonContent);
      setCopyError("");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError("无法访问剪贴板，请下载 JSON 文件。");
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
        {copyError ? <p role="alert" className="text-xs text-destructive">{copyError}</p> : null}
        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">关闭</Button></DialogClose>
          <Button variant="outline" onClick={() => { void handleCopy(); }}>{copied ? <><Check className="size-4" />已复制</> : "复制到剪贴板"}</Button>
          <Button onClick={handleDownload}><Download className="mr-1.5 size-3.5" />下载 JSON</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
