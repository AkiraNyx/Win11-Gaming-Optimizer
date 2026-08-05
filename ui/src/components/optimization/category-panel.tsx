"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getCommandExecution, getItemTarget } from "@/lib/presets";
import { isOptimizationTargetAllowed } from "@/lib/categories";
import { getFastStartupDependencyBlock } from "@/lib/config-dependencies";
import type { OptimizationCategory, PresetConfig, TargetValue } from "@/types/optimization";
import type { SystemStatus } from "@/types/system-status";
import { OptimizationItemRow } from "./optimization-item";

interface CategoryPanelProps {
  category: OptimizationCategory;
  config: PresetConfig;
  onTargetChange: (categoryId: string, itemId: string, target: TargetValue) => void;
  onCommandChange: (categoryId: string, itemId: string, execute: boolean) => void;
  onSyncCurrent: (categoryId: string) => void;
  systemStatus?: SystemStatus;
  disabled?: boolean;
  syncing?: boolean;
}

export function CategoryPanel({
  category,
  config,
  onTargetChange,
  onCommandChange,
  onSyncCurrent,
  systemStatus,
  disabled = false,
  syncing = false,
}: CategoryPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const hasSyncableTarget = category.items.some((item) => {
    if (item.control !== "switch" && item.control !== "select") return false;
    const itemStatus = systemStatus?.[category.id]?.[item.id];
    return !!itemStatus?.available
      && itemStatus.applicable !== false
      && itemStatus.stateConsistent !== false
      && itemStatus.currentValue !== null
      && isOptimizationTargetAllowed(item, itemStatus.currentValue);
  });
  const syncHelpId = `${category.id}-sync-help`;
  const syncHelp = hasSyncableTarget
    ? "同步可读取的目标状态；状态未知项保留原目标，一次性操作将取消待执行。"
    : "当前分类没有可同步的目标状态。";

  return (
    <section className="space-y-3" aria-labelledby={`${category.id}-heading`}>
      <div className="flex flex-col items-start justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0">
          <h2 id={`${category.id}-heading`} className="text-base font-semibold">{category.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{category.description}</p>
        </div>
        <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-disabled={disabled || !hasSyncableTarget}
                aria-describedby={syncHelpId}
                className={!hasSyncableTarget ? "cursor-not-allowed opacity-50" : undefined}
                onClick={() => { if (!disabled && hasSyncableTarget) onSyncCurrent(category.id); }}
              >
                {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {syncing ? "正在同步" : "同步为当前状态"}
              </Button>
            </TooltipTrigger>
            <TooltipContent id={syncHelpId} className="max-w-80">{syncHelp}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setExpanded((value) => !value)}
                disabled={disabled}
                aria-expanded={expanded}
                aria-label={expanded ? `收起${category.name}` : `展开${category.name}`}
              >
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                  <ChevronDown className="size-4" />
                </motion.span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{expanded ? "收起" : "展开"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="space-y-1.5 overflow-hidden"
          >
            {category.items.map((item) => (
              <OptimizationItemRow
                key={item.id}
                item={item}
                target={getItemTarget(config, category.id, item.id)}
                commandSelected={getCommandExecution(config, category.id, item.id)}
                onTargetChange={(target) => onTargetChange(category.id, item.id, target)}
                onCommandChange={(execute) => onCommandChange(category.id, item.id, execute)}
                systemStatus={systemStatus?.[category.id]?.[item.id]}
                disabled={disabled}
                getDependencyBlock={(target) => getFastStartupDependencyBlock(
                  config,
                  category.id,
                  item.id,
                  target,
                )}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
