"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Circle, LockKeyhole, Play, RotateCcw, Search } from "lucide-react";
import { Select } from "@arinox/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isOptimizationTargetAllowed, isPreserveOnlyTarget } from "@/lib/categories";
import { getTargetLabel, getTransitionWarning, isStatusTargetBlocked } from "@/lib/presets";
import type { ItemStatus } from "@/types/system-status";
import type { OptimizationItem, TargetValue, TransitionWarning } from "@/types/optimization";
import type { TargetDependencyBlock } from "@/lib/config-dependencies";
import { ConfirmToggleDialog } from "./confirm-toggle-dialog";
import { SafetyBadge } from "./safety-badge";
import { StatusLabel } from "./status-label";

interface OptimizationItemProps {
  item: OptimizationItem;
  target?: TargetValue;
  commandSelected?: boolean;
  onTargetChange: (target: TargetValue) => void;
  onCommandChange: (execute: boolean) => void;
  systemStatus?: ItemStatus | null;
  disabled?: boolean;
  getDependencyBlock?: (target: TargetValue) => TargetDependencyBlock | undefined;
}

function encodeValue(value: TargetValue): string {
  return `${typeof value}:${String(value)}`;
}

export function OptimizationItemRow({
  item,
  target,
  commandSelected = false,
  onTargetChange,
  onCommandChange,
  systemStatus,
  disabled = false,
  getDependencyBlock,
}: OptimizationItemProps) {
  const [pendingTarget, setPendingTarget] = useState<TargetValue | null>(null);
  const [pendingCommand, setPendingCommand] = useState(false);
  const [warning, setWarning] = useState<TransitionWarning | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const warningTriggerRef = useRef<HTMLElement | null>(null);
  const dependencyHelpId = useId();

  const options = useMemo(() => {
    const next = [...(item.options ?? [])];
    const currentValue = systemStatus?.currentValue;
    if (
      currentValue !== null
      && currentValue !== undefined
      && isOptimizationTargetAllowed(item, currentValue)
      && !next.some((option) => Object.is(option.value, currentValue))
    ) {
      next.push({ value: currentValue, label: `系统当前：${getTargetLabel(item, currentValue)}` });
    }
    if (target !== undefined && !next.some((option) => Object.is(option.value, target))) {
      next.push({ value: target, label: `配置目标：${getTargetLabel(item, target)}` });
    }
    return next;
  }, [item, systemStatus?.currentValue, target]);

  const notApplicable = systemStatus?.applicable === false;
  const requiresAllowedTarget = item.control === "switch" || item.control === "select";
  const unavailable = !notApplicable && (
    !systemStatus?.available
    || systemStatus.stateConsistent === false
    || systemStatus.currentValue === null
    || (requiresAllowedTarget && !isOptimizationTargetAllowed(item, systemStatus.currentValue))
  );
  const blocked = item.control === "command"
    ? commandSelected && isStatusTargetBlocked(systemStatus, true)
    : isStatusTargetBlocked(systemStatus, target);
  const controlDisabled = disabled || notApplicable || unavailable;
  const statusDescription = blocked
    ? systemStatus?.blockedReason
    : systemStatus?.description;
  const currentDependencyBlock = target === undefined ? undefined : getDependencyBlock?.(target);
  const prospectiveDependencyBlock = options
    .filter((option) => !Object.is(option.value, target))
    .map((option) => getDependencyBlock?.(option.value))
    .find((dependencyBlock) => dependencyBlock !== undefined);
  const dependencyBlock = currentDependencyBlock ?? prospectiveDependencyBlock;
  const nextSwitchTarget = typeof target === "boolean" ? !target : undefined;
  const switchDependencyBlock = nextSwitchTarget === undefined
    ? undefined
    : getDependencyBlock?.(nextSwitchTarget);

  const requestTarget = (nextTarget: TargetValue) => {
    if (Object.is(nextTarget, target)) return;
    if (getDependencyBlock?.(nextTarget)) return;
    if (
      isPreserveOnlyTarget(item, nextTarget)
      && !Object.is(nextTarget, systemStatus?.currentValue)
    ) return;
    if (systemStatus?.currentValue !== null && Object.is(nextTarget, systemStatus?.currentValue)) {
      onTargetChange(nextTarget);
      return;
    }
    const nextWarning = getTransitionWarning(item, systemStatus?.currentValue ?? null, nextTarget);
    if (!nextWarning) {
      onTargetChange(nextTarget);
      return;
    }
    warningTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingTarget(nextTarget);
    setPendingCommand(false);
    setWarning(nextWarning);
    setWarningOpen(true);
  };

  const requestCommand = () => {
    if (commandSelected) {
      onCommandChange(false);
      return;
    }
    const nextWarning = getTransitionWarning(item, null, true);
    if (!nextWarning) {
      onCommandChange(true);
      return;
    }
    warningTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingTarget(null);
    setPendingCommand(true);
    setWarning(nextWarning);
    setWarningOpen(true);
  };

  const currentLabel = item.control === "command"
    ? (commandSelected ? "待执行" : "未选择")
    : getTargetLabel(item, systemStatus?.currentValue ?? null);
  const targetLabel = pendingCommand ? "待执行" : getTargetLabel(item, pendingTarget);

  return (
    <>
      <div className="optimizer-item">
        <div className="flex min-w-0 items-start gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={statusDescription ?? "状态未知"}
                className="mt-0.5 cursor-help"
              >
                <Circle className={cn(
                  "size-2.5",
                   unavailable || notApplicable ? "fill-muted-foreground/40 text-muted-foreground/40" : "fill-emerald-500 text-emerald-500",
                )} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-80">
              <p className="text-xs">{statusDescription ?? "状态未知"}</p>
            </TooltipContent>
          </Tooltip>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{item.name}</span>
              <SafetyBadge level={item.safetyLevel} />
              <StatusLabel item={item} target={target} commandSelected={commandSelected} systemStatus={systemStatus} />
              {item.transitionWarnings?.length ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="此项包含需要确认的风险转换"
                      className="cursor-help"
                    >
                      <AlertTriangle className="size-3.5 text-amber-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-80"><p className="text-xs">调整到部分目标状态时需要确认。</p></TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </div>
        </div>

        <div className={cn(
          "flex min-w-0 flex-col items-start justify-start gap-1.5 sm:items-end sm:justify-end",
          dependencyBlock ? "w-full sm:w-64" : "sm:min-w-36",
        )}>
          {item.control === "switch" && typeof target === "boolean" ? (
            <Switch
              checked={target}
              onCheckedChange={requestTarget}
              disabled={controlDisabled || !!switchDependencyBlock}
              aria-label={`设置${item.name}目标状态`}
              aria-describedby={dependencyBlock ? dependencyHelpId : undefined}
            />
          ) : null}

          {item.control === "select" && target !== undefined ? (
            <Select
              value={encodeValue(target)}
              onChange={(event) => {
                const selected = options.find((option) => encodeValue(option.value) === event.target.value);
                if (selected) requestTarget(selected.value);
              }}
              disabled={controlDisabled}
              className="optimizer-select"
              aria-label={`设置${item.name}目标值`}
              aria-describedby={dependencyBlock ? dependencyHelpId : undefined}
            >
                {options.map((option) => (
                  <option
                    key={encodeValue(option.value)}
                    value={encodeValue(option.value)}
                    disabled={
                      !Object.is(option.value, systemStatus?.currentValue)
                      && (
                        isStatusTargetBlocked(systemStatus, option.value)
                        || isPreserveOnlyTarget(item, option.value)
                        || !!getDependencyBlock?.(option.value)
                      )
                    }
                  >
                    {option.label}
                  </option>
                ))}
            </Select>
          ) : null}

          {item.control === "command" ? (
            <Button
              size="sm"
              variant={commandSelected ? "outline" : "secondary"}
              onClick={requestCommand}
              disabled={disabled || notApplicable || (!commandSelected && (unavailable || blocked))}
              className="w-full sm:w-auto"
            >
              {commandSelected ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
              {commandSelected ? "取消待执行" : "执行一次"}
            </Button>
          ) : null}

          {item.control === "diagnostic" ? (
            <span className="inline-flex h-7 items-center gap-1.5 text-xs text-muted-foreground"><Search className="size-3.5" />只读</span>
          ) : null}

          {dependencyBlock ? (
            <p
              id={dependencyHelpId}
              className={cn(
                "flex max-w-64 items-start gap-1.5 text-left text-xs leading-relaxed",
                dependencyBlock.conflict
                  ? "text-destructive"
                  : "text-amber-700 dark:text-amber-300",
              )}
              role={dependencyBlock.conflict ? "alert" : "status"}
            >
              {dependencyBlock.conflict
                ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                : <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
              <span>{dependencyBlock.message}</span>
            </p>
          ) : null}
        </div>
      </div>

      {warning ? (
        <ConfirmToggleDialog
          open={warningOpen}
          onOpenChange={setWarningOpen}
          onAfterClose={() => { setWarning(null); setPendingTarget(null); setPendingCommand(false); }}
          item={item}
          currentLabel={currentLabel}
          targetLabel={targetLabel}
          warning={warning}
          onReturnFocus={() => warningTriggerRef.current?.focus()}
          onConfirm={() => {
            if (pendingCommand) onCommandChange(true);
            else if (pendingTarget !== null) onTargetChange(pendingTarget);
            setWarningOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
