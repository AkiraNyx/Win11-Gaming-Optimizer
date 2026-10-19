"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import type { ImportConfigResult } from "@/hooks/use-optimization-config";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (json: string, confirmLegacy?: boolean) => ImportConfigResult;
  onReturnFocus?: () => void;
}

const MAX_IMPORT_BYTES = 1024 * 1024;

export function ImportDialog({ open, onOpenChange, onImport, onReturnFocus }: ImportDialogProps) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [pendingLegacy, setPendingLegacy] = useState<{
    json: string;
    changed: number;
    highRisk: number;
    unavailable: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const readVersionRef = useRef(0);
  const cancelRead = useCallback(() => {
    readVersionRef.current++;
    readerRef.current?.abort();
    readerRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) setReading(false);
    return cancelRead;
  }, [open, cancelRead]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      cancelRead();
      setReading(false);
    }
    onOpenChange(nextOpen);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    cancelRead();
    setReading(false);
    setError("");
    if (file.size > MAX_IMPORT_BYTES) {
      setError("配置文件不能超过 1 MB");
      return;
    }
    const readVersion = readVersionRef.current;
    const reader = new FileReader();
    readerRef.current = reader;
    setReading(true);
    reader.onload = () => {
      if (readVersion !== readVersionRef.current) return;
      readerRef.current = null;
      setReading(false);
      const text = reader.result as string;
      const result = onImport(text);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      if (result.status === "preview") {
        setPendingLegacy({ json: text, ...result });
        setError("");
        return;
      }
      handleOpenChange(false);
    };
    reader.onerror = () => {
      if (readVersion !== readVersionRef.current) return;
      readerRef.current = null;
      setReading(false);
      setError("无法读取配置文件");
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onAfterClose={() => { setError(""); setPendingLegacy(null); }} onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus?.(); }}>
        <DialogHeader>
          <DialogTitle>{pendingLegacy ? "确认迁移旧版配置" : "导入配置"}</DialogTitle>
          <DialogDescription>
            {pendingLegacy
              ? "此文件将先从 v1 转换为 v2，确认后才会替换当前目标配置。"
              : "选择由本工具导出的 JSON 配置文件。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
          {pendingLegacy ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-3 border-y border-border py-4 text-center text-sm">
                <div><dt className="text-muted-foreground">待调整</dt><dd className="mt-1 font-mono text-lg font-semibold">{pendingLegacy.changed}</dd></div>
                <div><dt className="text-muted-foreground">高风险</dt><dd className="mt-1 font-mono text-lg font-semibold text-destructive">{pendingLegacy.highRisk}</dd></div>
                <div><dt className="text-muted-foreground">状态未知</dt><dd className="mt-1 font-mono text-lg font-semibold">{pendingLegacy.unavailable}</dd></div>
              </dl>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  fileRef.current?.click();
                }}
              >
                <Upload className="size-4" />选择其他文件
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />选择 JSON 文件
            </Button>
          )}
          {reading ? <p role="status" className="text-xs text-muted-foreground">正在读取配置文件…</p> : null}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
          {pendingLegacy ? (
            <Button disabled={reading} onClick={() => {
              const result = onImport(pendingLegacy.json, true);
              if (result.status === "error") {
                setError(result.error);
                return;
              }
              if (result.status === "applied") {
                handleOpenChange(false);
              }
            }}>确认迁移并导入</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
