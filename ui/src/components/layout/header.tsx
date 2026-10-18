"use client";

import { useEffect, useState } from "react";
import { Glass } from "@arinox/react";
import { Copy, Download, Gamepad2, Minus, Moon, RotateCcw, Square, Sun, Undo2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onExport: () => void; onImport: () => void; onReset: () => void; onRestore: () => void; onUninstall: () => void;
  configActionsDisabled?: boolean; disabled?: boolean; disabledReason?: string;
  mutationDisabled?: boolean; mutationDisabledReason?: string;
  uninstallDisabled?: boolean; uninstallDisabledReason?: string;
}
function DisabledAction({ reason, label, children }: { reason?: string; label: string; children: React.ReactNode }) {
  if (!reason) return children;
  return <Tooltip><TooltipTrigger asChild>
    <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${label}不可用：${reason}`}>{children}</span>
  </TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip>;
}
export function Header({ onExport, onImport, onReset, onRestore, onUninstall, configActionsDisabled, disabled = false, disabledReason, mutationDisabled = false, mutationDisabledReason, uninstallDisabled = false, uninstallDisabledReason }: HeaderProps) {
  const electronWindow = typeof window === "undefined" ? undefined : window.win11Optimizer;
  const [maximized, setMaximized] = useState(false);
  const { theme, toggleTheme } = useTheme();
  useEffect(() => electronWindow?.onMaximizeChange(setMaximized), [electronWindow]);
  const restoreReason = disabled ? disabledReason : mutationDisabled ? mutationDisabledReason : undefined;
  const undoReason = disabled ? disabledReason : mutationDisabled ? mutationDisabledReason : uninstallDisabled ? uninstallDisabledReason : undefined;
  return <header className="optimizer-header">
    <div className={cn("optimizer-titlebar", electronWindow && "electron-drag-region")}>
      <div className="optimizer-brand"><span className="optimizer-brand-mark"><Gamepad2 className="size-5" /></span>
        <div><h1>Win11 Optimizer</h1><p>让系统，回到适合你的状态。</p></div>
      </div>
      <div className="electron-no-drag ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === "day" ? "切换夜间主题" : "切换日间主题"} title={theme === "day" ? "夜间主题" : "日间主题"}>
          {theme === "day" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
        {electronWindow && <div className="optimizer-window-controls" aria-label="窗口控制">
          <Button variant="ghost" size="icon-lg" onClick={() => electronWindow.minimize()} aria-label="最小化窗口"><Minus className="size-4" /></Button>
          <Button variant="ghost" size="icon-lg" onClick={() => electronWindow.toggleMaximize()} aria-label={maximized ? "还原窗口" : "最大化窗口"}>{maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}</Button>
          <Button variant="ghost" size="icon-lg" onClick={() => electronWindow.close()} aria-label="关闭窗口" className="optimizer-window-close"><X className="size-4" /></Button>
        </div>}
      </div>
    </div>
    <Glass className="optimizer-actionbar">
      <span className="optimizer-eyebrow optimizer-actionbar-label">配置与恢复</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onImport} disabled={disabled}><Upload className="size-3.5" />导入配置</Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={disabled || configActionsDisabled}><Download className="size-3.5" />导出 JSON</Button>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled || configActionsDisabled} aria-label="重置为平衡预设"><RotateCcw className="size-3.5" />重置预设</Button>
      </div>
      <div className="optimizer-recovery-actions">
        <DisabledAction reason={restoreReason} label="恢复设置"><Button variant="outline" size="sm" onClick={onRestore} disabled={!!restoreReason}><RotateCcw className="size-3.5" />恢复设置</Button></DisabledAction>
        <DisabledAction reason={undoReason} label="撤销全部优化"><Button variant="ghost" size="sm" className="text-destructive" onClick={onUninstall} disabled={!!undoReason}><Undo2 className="size-3.5" />撤销全部优化</Button></DisabledAction>
      </div>
    </Glass>
  </header>;
}
