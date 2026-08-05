"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Gamepad2, Minus, RotateCcw, Square, Undo2, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  onRestore: () => void;
  onUninstall: () => void;
  configActionsDisabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  mutationDisabled?: boolean;
  mutationDisabledReason?: string;
  uninstallDisabled?: boolean;
  uninstallDisabledReason?: string;
}

interface DisabledActionProps {
  reason?: string;
  label: string;
  children: React.ReactNode;
}

function DisabledAction({ reason, label, children }: DisabledActionProps) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${label}不可用：${reason}`}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function Header({
  onExport,
  onImport,
  onReset,
  onRestore,
  onUninstall,
  configActionsDisabled,
  disabled = false,
  disabledReason,
  mutationDisabled = false,
  mutationDisabledReason,
  uninstallDisabled = false,
  uninstallDisabledReason,
}: HeaderProps) {
  const electronWindow = typeof window === "undefined" ? undefined : window.win11Optimizer;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => electronWindow?.onMaximizeChange(setMaximized), [electronWindow]);

  const restoreReason = disabled ? disabledReason : mutationDisabled ? mutationDisabledReason : undefined;
  const undoReason = disabled
    ? disabledReason
    : mutationDisabled
      ? mutationDisabledReason
      : uninstallDisabled ? uninstallDisabledReason : undefined;
  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={onImport} disabled={disabled}><Upload className="size-3.5" />导入配置</Button>
      <Button variant="outline" size="sm" onClick={onExport} disabled={disabled || configActionsDisabled}><Download className="size-3.5" />导出 JSON</Button>
      <div className="hidden h-5 w-px bg-border sm:block" />
      <DisabledAction reason={restoreReason} label="恢复设置">
        <Button variant="outline" size="sm" onClick={onRestore} disabled={!!restoreReason}><RotateCcw className="size-3.5" />恢复设置</Button>
      </DisabledAction>
      <DisabledAction reason={undoReason} label="撤销全部优化">
        <Button variant="destructive" size="sm" onClick={onUninstall} disabled={!!undoReason}><Undo2 className="size-3.5" />撤销全部优化</Button>
      </DisabledAction>
      <Button variant="ghost" size="icon-sm" onClick={onReset} disabled={disabled || configActionsDisabled} aria-label="重置为平衡预设" title="重置为平衡预设"><RotateCcw className="size-3.5" /></Button>
    </>
  );

  return (
    <TooltipProvider>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="shrink-0 border-b border-border bg-background"
      >
        <div className={cn("flex min-h-12 items-stretch", electronWindow && "electron-drag-region")}>
          <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2 lg:px-6">
            <Gamepad2 className="size-6 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold sm:text-lg">Windows 11 游戏优化工具</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">目标状态 · 变更记录 · 硬件感知</p>
            </div>
          </div>
          <div className={cn("hidden min-w-0 items-center gap-2 px-2 xl:flex", electronWindow && "electron-no-drag")}>
            {actions}
          </div>
          {electronWindow ? (
            <div className="electron-no-drag ml-auto flex shrink-0" aria-label="窗口控制">
              <Button variant="ghost" size="icon-lg" className="h-12 w-12 rounded-none" onClick={() => electronWindow.minimize()} aria-label="最小化窗口"><Minus className="size-4" /></Button>
              <Button variant="ghost" size="icon-lg" className="h-12 w-12 rounded-none" onClick={() => electronWindow.toggleMaximize()} aria-label={maximized ? "还原窗口" : "最大化窗口"}>
                {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
              </Button>
              <Button variant="ghost" size="icon-lg" className="h-12 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground focus-visible:bg-destructive/10 focus-visible:text-destructive" onClick={() => electronWindow.close()} aria-label="关闭窗口"><X className="size-4" /></Button>
            </div>
          ) : null}
        </div>
        <div className={cn("flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 xl:hidden", electronWindow && "electron-no-drag")}>
          {actions}
        </div>
      </motion.header>
    </TooltipProvider>
  );
}
