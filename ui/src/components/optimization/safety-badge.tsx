"use client";

import { cn } from "@/lib/utils";

interface SafetyBadgeProps { level: "conservative" | "balanced" | "extreme"; className?: string; }

const levelConfig = {
  conservative: { label: "低风险", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  balanced: { label: "中风险", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  extreme: { label: "高风险", color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export function SafetyBadge({ level, className }: SafetyBadgeProps) {
  const config = levelConfig[level];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", config.color, className)}>{config.label}</span>;
}
