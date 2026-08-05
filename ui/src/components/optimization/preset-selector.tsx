"use client";

import type { Ref } from "react";
import { cn } from "@/lib/utils";
import { Shield, Scale, Flame, CircleDot, Loader2 } from "lucide-react";
import type { PresetLevel } from "@/types/optimization";
import { motion } from "motion/react";

interface PresetSelectorProps {
  activePreset: PresetLevel;
  onSelect: (preset: PresetLevel) => void;
  loading?: boolean;
  currentDisabled?: boolean;
  disabled?: boolean;
  currentButtonRef?: Ref<HTMLButtonElement>;
}

const presets = [
  { id: "current" as PresetLevel, label: "当前", icon: CircleDot, desc: "当前系统状态" },
  { id: "conservative" as PresetLevel, label: "保守", icon: Shield, desc: "稳定优先" },
  { id: "balanced" as PresetLevel, label: "平衡", icon: Scale, desc: "性能与稳定兼顾" },
  { id: "extreme" as PresetLevel, label: "极致", icon: Flame, desc: "最大性能" },
];

export function PresetSelector({ activePreset, onSelect, loading, currentDisabled, disabled, currentButtonRef }: PresetSelectorProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-muted-foreground">预设：</span>
      {presets.map((p) => {
        const Icon = p.icon; const active = activePreset === p.id;
        return (
          <motion.button key={p.id} whileHover={disabled ? undefined : { scale: 1.03 }} whileTap={disabled ? undefined : { scale: 0.97 }}
            ref={p.id === "current" ? currentButtonRef : undefined}
            type="button"
            onClick={() => onSelect(p.id)} disabled={disabled || (p.id === "current" && currentDisabled)}
            aria-pressed={active}
            aria-label={`${p.label}预设：${p.desc}`}
            className={cn("relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3",
              active ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground")}>
            {loading && p.id === "current" ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{p.label}
            {active && <motion.div layoutId="preset-indicator" className="absolute inset-0 rounded-md bg-primary -z-10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
          </motion.button>
        );
      })}
      {activePreset === "custom" && <span className="text-xs text-muted-foreground italic">（已自定义）</span>}
    </div>
  );
}
