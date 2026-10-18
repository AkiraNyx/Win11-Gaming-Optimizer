"use client";
import type { Ref } from "react";
import { SegmentedControl } from "@arinox/react";
import { Shield, Scale, Flame, CircleDot, Loader2 } from "lucide-react";
import type { PresetLevel } from "@/types/optimization";

interface PresetSelectorProps {
  activePreset: PresetLevel; onSelect: (preset: PresetLevel) => void; loading?: boolean;
  currentDisabled?: boolean; disabled?: boolean; currentButtonRef?: Ref<HTMLButtonElement>;
}
const presets = [
  { id: "current", label: "当前", icon: CircleDot, desc: "当前系统状态" },
  { id: "conservative", label: "保守", icon: Shield, desc: "稳定优先" },
  { id: "balanced", label: "平衡", icon: Scale, desc: "性能与稳定兼顾" },
  { id: "extreme", label: "极致", icon: Flame, desc: "最大性能" },
] as const;
export function PresetSelector({ activePreset, onSelect, loading, currentDisabled, disabled, currentButtonRef }: PresetSelectorProps) {
  return <div className="optimizer-presets">
    <span className="optimizer-eyebrow">目标预设</span>
    <SegmentedControl label="目标预设" value={activePreset} onValueChange={value => onSelect(value as PresetLevel)}
      options={presets.map(({ id, label, icon: Icon, desc }) => ({
        value: id, label: <>{loading && id === "current" ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{label}</>,
        disabled: disabled || (id === "current" && currentDisabled),
        buttonProps: {
          ref: id === "current" ? currentButtonRef : undefined,
          "aria-label": `${label}预设：${desc}`, title: desc,
          onClick: id === "current" ? event => { event.preventDefault(); onSelect("current"); } : undefined,
        },
      }))} />
    {activePreset === "custom" && <span className="text-xs text-muted-foreground">已自定义</span>}
  </div>;
}
