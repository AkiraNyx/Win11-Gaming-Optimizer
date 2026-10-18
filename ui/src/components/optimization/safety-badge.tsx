"use client";

import { cn } from "@/lib/utils";

interface SafetyBadgeProps { level: "conservative" | "balanced" | "extreme"; className?: string; }

const levelConfig = {
  conservative: { label: "低风险", color: "bg-[color-mix(in_srgb,var(--ax-color-success)_10%,transparent)] text-[var(--ax-color-success)] border-[color-mix(in_srgb,var(--ax-color-success)_20%,transparent)]" },
  balanced: { label: "中风险", color: "bg-[color-mix(in_srgb,var(--ax-color-warning)_10%,transparent)] text-[var(--ax-color-warning)] border-[color-mix(in_srgb,var(--ax-color-warning)_20%,transparent)]" },
  extreme: { label: "高风险", color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export function SafetyBadge({ level, className }: SafetyBadgeProps) {
  const config = levelConfig[level];
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", config.color, className)}>{config.label}</span>;
}
