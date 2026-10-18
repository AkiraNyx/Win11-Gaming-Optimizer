"use client";

import { cn } from "@/lib/utils";
import { categories } from "@/lib/categories";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HardwareInfo } from "@/types/hardware";
import { Download, Zap, ArrowUpDown, Settings, Battery, HardDrive, Cpu, Gauge, Monitor, Wifi, Palette, Shield, Lock, MemoryStick, Terminal } from "lucide-react";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = { Download, Zap, ArrowUpDown, Settings, Battery, HardDrive, Cpu, Gauge, Monitor, Wifi, Palette, Shield, Lock, MemoryStick };
interface SidebarProps {
  activeCategory: string; onSelect: (id: string) => void; onShowLog: () => void;
  changeCounts: Record<string, number>; hardware: HardwareInfo; logOpen?: boolean; disabled?: boolean;
}
export function Sidebar({ activeCategory, onSelect, onShowLog, changeCounts, hardware, logOpen = false, disabled = false }: SidebarProps) {
  const storage = hardware.hasSSD ? `SSD${hardware.hasHDD ? " + HDD" : ""}` : hardware.hasHDD ? "HDD" : "未知";
  const cpu = hardware.cpuName && hardware.cpuName !== "Unknown" ? hardware.cpuName : "未知 CPU";
  const gpu = hardware.gpuName && hardware.gpuName !== "Unknown" ? hardware.gpuName : "未知 GPU";
  return <aside className="optimizer-sidebar">
    <div className="optimizer-sidebar-heading"><span className="optimizer-eyebrow">优化分类</span><span className="font-mono text-xs text-muted-foreground">14</span></div>
    <nav aria-label="优化分类" className="optimizer-navigation thin-scroll">
      {categories.map(cat => {
        const Icon = iconMap[cat.icon] || Settings;
        const active = activeCategory === cat.id;
        const count = changeCounts[cat.id] ?? 0;
        return <button key={cat.id} type="button" onClick={() => onSelect(cat.id)} disabled={disabled} aria-current={active ? "page" : undefined}
          className={cn("optimizer-nav-item", active && "is-active")}>
          <Icon className="size-4 shrink-0" /><span>{cat.name}</span>
          {count > 0 && <Badge variant="outline" className="optimizer-nav-count" aria-label={`${cat.name}有 ${count} 项待修改`}>{count}</Badge>}
        </button>;
      })}
    </nav>
    <details className="optimizer-hardware" open>
      <summary className="optimizer-eyebrow cursor-pointer">这台电脑</summary>
      <dl>
        {([{ icon: Cpu, name: "处理器", value: cpu }, { icon: Monitor, name: "显卡", value: gpu }] as const).map(({ icon: Icon, name, value }) => <div key={name}>
          <dt><Icon className="size-3.5" />{name}</dt><Tooltip><TooltipTrigger asChild>
            <dd tabIndex={0} className="truncate" aria-label={`${name}：${value}`}>{value}</dd>
          </TooltipTrigger><TooltipContent side="right">{value}</TooltipContent></Tooltip>
        </div>)}
        <div className="optimizer-hardware-pair"><div><dt><MemoryStick className="size-3.5" />内存</dt><dd className="font-mono">{hardware.ramGB > 0 ? `${hardware.ramGB} GB` : "未知"}</dd></div>
          <div><dt><HardDrive className="size-3.5" />存储</dt><dd className="font-mono">{storage}</dd></div></div>
        <div className="text-xs text-muted-foreground">{hardware.cpuCores > 0 ? `${hardware.cpuCores} 个处理器核心` : "核心数未知"}</div>
      </dl>
    </details>
    <button type="button" onClick={onShowLog} disabled={disabled} aria-haspopup="dialog" aria-expanded={logOpen} className="optimizer-nav-item optimizer-log-button"><Terminal className="size-4" /><span>运行日志</span><span className="ml-auto text-xs">↗</span></button>
  </aside>;
}
