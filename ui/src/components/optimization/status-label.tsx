"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isOptimizationTargetAllowed, isPreserveOnlyTarget } from "@/lib/categories";
import { compareCurrentToTarget, getTargetLabel, isStatusTargetBlocked } from "@/lib/presets";
import type { ItemStatus } from "@/types/system-status";
import type { OptimizationItem, TargetValue } from "@/types/optimization";

interface StatusLabelProps {
  item: OptimizationItem;
  target?: TargetValue;
  commandSelected?: boolean;
  systemStatus?: ItemStatus | null;
}

export function StatusLabel({ item, target, commandSelected, systemStatus }: StatusLabelProps) {
  let label = "未修改";
  let tone = "bg-muted text-muted-foreground border-border";

  if (systemStatus?.applicable === false) {
    label = "不适用";
  } else if (systemStatus?.stateConsistent === false) {
    label = "状态不一致";
    tone = "bg-destructive/10 text-destructive border-destructive/20";
  } else if (item.control === "diagnostic") {
    label = systemStatus?.available ? "只读状态" : "状态未知";
  } else if (item.control === "command") {
    if (!systemStatus?.available) {
      label = "状态未知";
    } else if (commandSelected && isStatusTargetBlocked(systemStatus, true)) {
      label = "调整受限";
      tone = "bg-destructive/10 text-destructive border-destructive/20";
    } else if (!commandSelected) {
      label = "未选择";
    } else {
      label = "待执行";
      tone = "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
    }
  } else if (
    !systemStatus?.available
    || systemStatus.currentValue === null
    || target === undefined
    || !isOptimizationTargetAllowed(item, systemStatus.currentValue)
  ) {
    label = "状态未知";
  } else if (
    isPreserveOnlyTarget(item, target)
    && !compareCurrentToTarget(systemStatus.currentValue, target)
  ) {
    label = "不支持调整";
    tone = "bg-destructive/10 text-destructive border-destructive/20";
  } else if (isStatusTargetBlocked(systemStatus, target) && !compareCurrentToTarget(systemStatus.currentValue, target)) {
    label = "调整受限";
    tone = "bg-destructive/10 text-destructive border-destructive/20";
  } else if (!compareCurrentToTarget(systemStatus.currentValue, target)) {
    if (typeof target === "boolean") label = target ? "待启用" : "待关闭";
    else if (target === "manual") label = "待设为手动";
    else if (target === "disabled") label = "待设为禁用";
    else label = `待设为 ${getTargetLabel(item, target)}`;
    tone = "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
  }

  return (
    <Badge variant="outline" className={cn("h-5 shrink-0 px-1.5 py-0 text-[10px] font-normal", tone)}>
      {label}
    </Badge>
  );
}
