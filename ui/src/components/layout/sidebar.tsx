"use client";

import { cn } from "@/lib/utils";
import { categories } from "@/lib/categories";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { HardwareInfo } from "@/types/hardware";
import {
  Download, Zap, ArrowUpDown, Settings, Battery, HardDrive, Cpu,
  Gauge, Monitor, Wifi, Palette, Shield, Lock, MemoryStick, Terminal,
} from "lucide-react";
import { motion } from "motion/react";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Download, Zap, ArrowUpDown, Settings, Battery, HardDrive, Cpu,
  Gauge, Monitor, Wifi, Palette, Shield, Lock, MemoryStick,
};

interface SidebarProps {
  activeCategory: string;
  onSelect: (id: string) => void;
  onShowLog: () => void;
  changeCounts: Record<string, number>;
  hardware: HardwareInfo;
  logOpen?: boolean;
  disabled?: boolean;
}

export function Sidebar({ activeCategory, onSelect, onShowLog, changeCounts, hardware, logOpen = false, disabled = false }: SidebarProps) {
  const storageLabel = hardware.hasSSD
    ? `SSD${hardware.hasHDD ? " + HDD" : ""}`
    : hardware.hasHDD ? "HDD" : "未知";
  const ramLabel = hardware.ramGB > 0 ? `${hardware.ramGB} GB` : "未知";
  const cpuCoresLabel = hardware.cpuCores > 0 ? `${hardware.cpuCores} 核心` : "未知";
  const cpuLabel = hardware.cpuName && hardware.cpuName !== "Unknown" ? hardware.cpuName : "未知 CPU";
  const gpuLabel = hardware.gpuName && hardware.gpuName !== "Unknown" ? hardware.gpuName : "未知 GPU";

  return (
    <TooltipProvider>
    <nav aria-label="优化分类" className="flex h-auto w-full shrink-0 flex-col border-b border-border bg-card/50 p-2 md:h-full md:w-64 md:border-r md:border-b-0">
      <div className="thin-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden md:block md:space-y-0.5 md:overflow-x-hidden md:overflow-y-auto">
        {categories.map((cat) => {
          const Icon = iconMap[cat.icon] || Settings;
          const isActive = activeCategory === cat.id;
          const changeCount = changeCounts[cat.id] ?? 0;

          return (
            <motion.button
              key={cat.id}
              whileHover={disabled ? undefined : { x: 2 }}
              whileTap={disabled ? undefined : { scale: 0.98 }}
              type="button"
              onClick={() => onSelect(cat.id)}
              disabled={disabled}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-auto shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:w-full",
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{cat.name}</span>
              {changeCount > 0 ? (
                <Badge
                  variant={isActive ? "secondary" : "outline"}
                  className="ml-auto min-w-5 px-1.5 font-mono tabular-nums"
                  aria-label={`${cat.name}有 ${changeCount} 项待修改`}
                >
                  {changeCount}
                </Badge>
              ) : null}
            </motion.button>
          );
        })}
      </div>
      <div className="shrink-0 px-2 py-3">
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">硬件概览</p>
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-1">
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground"><HardDrive className="size-3" />存储</dt>
            <dd className="mt-0.5 truncate font-mono text-xs">{storageLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground"><MemoryStick className="size-3" />内存</dt>
            <dd className="mt-0.5 truncate font-mono text-xs">{ramLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground"><Monitor className="size-3" />显卡</dt>
            <Tooltip>
              <TooltipTrigger asChild>
                <dd tabIndex={0} className="mt-0.5 truncate text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`显卡：${gpuLabel}`}>{gpuLabel}</dd>
              </TooltipTrigger>
              <TooltipContent side="right">{gpuLabel}</TooltipContent>
            </Tooltip>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground"><Cpu className="size-3" />CPU</dt>
            <Tooltip>
              <TooltipTrigger asChild>
                <dd tabIndex={0} className="mt-0.5 truncate text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`CPU：${cpuLabel}，${cpuCoresLabel}`}>{cpuLabel}</dd>
              </TooltipTrigger>
              <TooltipContent side="right">{cpuLabel} · {cpuCoresLabel}</TooltipContent>
            </Tooltip>
            <dd className="mt-0.5 font-mono text-[11px] text-muted-foreground">{cpuCoresLabel}</dd>
          </div>
        </dl>
      </div>
      <div className="shrink-0 border-t border-border pt-2">
        <motion.button
          whileHover={disabled ? undefined : { x: 2 }}
          whileTap={disabled ? undefined : { scale: 0.98 }}
          type="button"
          onClick={onShowLog}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={logOpen}
          className="flex w-auto shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 md:w-full"
        >
          <Terminal className="size-4 shrink-0" />
          <span className="truncate">运行日志</span>
        </motion.button>
      </div>
    </nav>
    </TooltipProvider>
  );
}
