import type { PresetConfig, TargetValue } from "@/types/optimization";

const FAST_STARTUP_CATEGORY = "bootOptimization";
const FAST_STARTUP_ITEM = "fastStartup";
const HIBERNATION_CATEGORY = "storageOptimization";
const HIBERNATION_ITEM = "disableHibernation";

export interface TargetDependencyBlock {
  conflict: boolean;
  message: string;
}

function getTarget(config: PresetConfig, categoryId: string, itemId: string): TargetValue | undefined {
  const item = config.categories[categoryId]?.items[itemId];
  return item && "target" in item ? item.target : undefined;
}

export function hasFastStartupHibernationConflict(config: PresetConfig): boolean {
  return getTarget(config, FAST_STARTUP_CATEGORY, FAST_STARTUP_ITEM) === true
    && getTarget(config, HIBERNATION_CATEGORY, HIBERNATION_ITEM) === false;
}

export function getFastStartupDependencyBlock(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
  nextTarget: TargetValue,
): TargetDependencyBlock | undefined {
  const isFastStartup = categoryId === FAST_STARTUP_CATEGORY && itemId === FAST_STARTUP_ITEM;
  const isHibernation = categoryId === HIBERNATION_CATEGORY && itemId === HIBERNATION_ITEM;
  if (!isFastStartup && !isHibernation) return undefined;

  const currentFastStartup = getTarget(config, FAST_STARTUP_CATEGORY, FAST_STARTUP_ITEM);
  const currentHibernation = getTarget(config, HIBERNATION_CATEGORY, HIBERNATION_ITEM);
  const nextFastStartup = isFastStartup ? nextTarget : currentFastStartup;
  const nextHibernation = isHibernation ? nextTarget : currentHibernation;
  if (nextFastStartup !== true || nextHibernation !== false) return undefined;

  const currentTarget = isFastStartup ? currentFastStartup : currentHibernation;
  const conflict = hasFastStartupHibernationConflict(config) && Object.is(currentTarget, nextTarget);
  return {
    conflict,
    message: conflict
      ? "当前目标配置冲突：快速启动需要休眠支持。请关闭快速启动或开启休眠。"
      : isFastStartup
        ? "开启快速启动前，请先在“存储优化”中开启休眠。"
        : "关闭休眠前，请先在“启动优化”中关闭快速启动。",
  };
}
