"use client";

import { useState, useCallback, useEffect } from "react";
import type { PresetConfig, PresetLevel, TargetValue } from "@/types/optimization";
import type { SystemStatus } from "@/types/system-status";
import {
  convertConfig,
  countChanges,
  createCurrentConfig,
  generatePresetConfig,
  getCommandExecution,
  getItemTarget,
  migrateLegacyV1Config,
  resolveSyncedActivePreset,
  setCommandExecution,
  setItemTarget,
} from "@/lib/presets";
import { categories, getOptimizationItem, isOptimizationTargetAllowed } from "@/lib/categories";
import { validateConfig, validateLegacyV1Config } from "@/lib/config-validator";
import { getFastStartupDependencyBlock } from "@/lib/config-dependencies";

const STORAGE_KEY = "win11-optimizer-config";

interface OptimizationState {
  config: PresetConfig;
  activePreset: PresetLevel;
  awaitingCurrent: boolean;
  pendingLegacyConfig?: unknown;
  preserveStoredConfig?: boolean;
  configError?: string;
}

interface CategorySyncError {
  categoryId: string;
  message: string;
}

export type ImportConfigResult =
  | { status: "applied" }
  | { status: "preview"; changed: number; highRisk: number; unavailable: number }
  | { status: "error"; error: string };

function fallbackState(): OptimizationState {
  const balanced = generatePresetConfig("balanced");
  return { config: balanced, activePreset: "current", awaitingCurrent: true };
}

function clearStoredConfig(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage restrictions do not prevent using the in-memory configuration.
  }
}

function hasStoredConfigLock(state: OptimizationState): boolean {
  return !!state.pendingLegacyConfig || !!state.preserveStoredConfig;
}

function keepStoredConfigLocked(state: OptimizationState): OptimizationState {
  return {
    ...state,
    configError: state.pendingLegacyConfig
      ? "旧版本地配置尚未完成迁移，请等待系统状态读取或导入有效配置"
      : "本地配置无效，原始数据仍已保留；请导入有效配置或明确放弃原配置",
  };
}

function loadSavedState(): OptimizationState {
  if (typeof window === "undefined") return fallbackState();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return fallbackState();
    const parsed = JSON.parse(saved) as unknown;
    const current = validateConfig(parsed);
    if (current.valid && current.config) {
      clearStoredConfig();
      return fallbackState();
    }

    const legacy = validateLegacyV1Config(parsed);
    if (legacy.valid && legacy.config) {
      return {
        ...fallbackState(),
        pendingLegacyConfig: legacy.config,
        configError: "检测到旧版本地配置，正在等待系统状态以完成迁移",
      };
    }

    return {
      ...fallbackState(),
      preserveStoredConfig: true,
      configError: "本地配置无效，原始数据已保留，请导入有效配置或明确放弃原配置",
    };
  } catch {
    return {
      ...fallbackState(),
      preserveStoredConfig: true,
      configError: "本地配置无法解析，原始数据已保留，请导入有效配置或明确放弃原配置",
    };
  }
}

export function useOptimizationConfig(systemStatus?: SystemStatus) {
  const [{ config, activePreset, awaitingCurrent, pendingLegacyConfig, preserveStoredConfig, configError }, setState] = useState<OptimizationState>(loadSavedState);
  const [categorySyncError, setCategorySyncError] = useState<CategorySyncError | null>(null);
  const configurationLocked = !!pendingLegacyConfig || !!preserveStoredConfig;

  useEffect(() => {
    if (!pendingLegacyConfig || !systemStatus || Object.keys(systemStatus).length === 0) return;
    const migrated = migrateLegacyV1Config(pendingLegacyConfig, systemStatus);
    if (migrated.success) {
      clearStoredConfig();
      setState({
        config: migrated.config,
        activePreset: migrated.config.preset,
        awaitingCurrent: false,
      });
    } else {
      setState((previous) => ({
        ...previous,
        configError: `旧版配置迁移失败：${migrated.errors.slice(0, 3).join("；")}`,
      }));
    }
  }, [pendingLegacyConfig, systemStatus]);

  const updateTarget = useCallback((categoryId: string, itemId: string, target: TargetValue) => {
    setState((previous) => {
      if (hasStoredConfigLock(previous)) return keepStoredConfigLocked(previous);
      if (getFastStartupDependencyBlock(previous.config, categoryId, itemId, target)) return previous;
      const nextConfig = setItemTarget(previous.config, categoryId, itemId, target);
      if (nextConfig === previous.config) return previous;
      nextConfig.preset = "custom";
      return { ...previous, config: nextConfig, activePreset: "custom", configError: undefined };
    });
  }, []);

  const updateCommand = useCallback((categoryId: string, itemId: string, execute: boolean) => {
    setState((previous) => {
      if (hasStoredConfigLock(previous)) return keepStoredConfigLocked(previous);
      const nextConfig = setCommandExecution(previous.config, categoryId, itemId, execute);
      if (nextConfig === previous.config) return previous;
      nextConfig.preset = "custom";
      return { ...previous, config: nextConfig, activePreset: "custom", configError: undefined };
    });
  }, []);

  const syncCategoryToCurrent = useCallback((categoryId: string, status: SystemStatus) => {
    if (configurationLocked) {
      setState((previous) => keepStoredConfigLocked(previous));
      return false;
    }
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) return false;
    const syncable = category.items.filter((item) => {
      if (item.control !== "switch" && item.control !== "select") return false;
      const itemStatus = status[categoryId]?.[item.id];
      return !!itemStatus?.available
        && itemStatus.applicable !== false
        && itemStatus.stateConsistent !== false
        && itemStatus.currentValue !== null
        && isOptimizationTargetAllowed(item, itemStatus.currentValue);
    });
    if (syncable.length === 0) {
      setCategorySyncError({
        categoryId,
        message: `“${category.name}”没有可同步的目标状态。`,
      });
      return false;
    }

    for (const item of syncable) {
      const currentValue = status[categoryId]?.[item.id]?.currentValue;
      if (currentValue === null || currentValue === undefined) continue;
      const dependencyBlock = getFastStartupDependencyBlock(config, categoryId, item.id, currentValue);
      if (dependencyBlock && !dependencyBlock.conflict) {
        setCategorySyncError({
          categoryId,
          message: `无法同步“${category.name}”：${dependencyBlock.message}`,
        });
        return false;
      }
    }

    setState((previous) => {
      let nextConfig = previous.config;
      const syncableIds = new Set(syncable.map((item) => item.id));
      for (const item of category.items) {
        if (item.control === "command") {
          nextConfig = setCommandExecution(nextConfig, categoryId, item.id, false);
        } else if (syncableIds.has(item.id)) {
          const currentValue = status[categoryId]?.[item.id]?.currentValue;
          if (currentValue !== null && currentValue !== undefined) {
            nextConfig = setItemTarget(nextConfig, categoryId, item.id, currentValue);
          }
        }
      }
      if (nextConfig === previous.config) return previous;
      const nextActivePreset = resolveSyncedActivePreset(nextConfig, status);
      nextConfig.preset = "custom";
      return {
        ...previous,
        config: nextConfig,
        activePreset: nextActivePreset,
        awaitingCurrent: false,
        configError: undefined,
      };
    });
    setCategorySyncError((previous) => previous?.categoryId === categoryId ? null : previous);
    return true;
  }, [configurationLocked, config]);

  const clearCategorySyncError = useCallback((categoryId: string) => {
    setCategorySyncError((previous) => previous?.categoryId === categoryId ? null : previous);
  }, []);

  const toggleItem = useCallback((categoryId: string, itemId: string) => {
    const metadata = getOptimizationItem(categoryId, itemId);
    if (metadata?.control === "command") {
      setState((previous) => {
        if (hasStoredConfigLock(previous)) return keepStoredConfigLocked(previous);
        const current = getCommandExecution(previous.config, categoryId, itemId);
        if (current === undefined) return previous;
        const nextConfig = setCommandExecution(previous.config, categoryId, itemId, !current);
        nextConfig.preset = "custom";
        return { ...previous, config: nextConfig, activePreset: "custom", configError: undefined };
      });
      return;
    }
    if (metadata?.control !== "switch") return;
    setState((previous) => {
      if (hasStoredConfigLock(previous)) return keepStoredConfigLocked(previous);
      const current = getItemTarget(previous.config, categoryId, itemId);
      if (typeof current !== "boolean") return previous;
      if (getFastStartupDependencyBlock(previous.config, categoryId, itemId, !current)) return previous;
      const nextConfig = setItemTarget(previous.config, categoryId, itemId, !current);
      nextConfig.preset = "custom";
      return { ...previous, config: nextConfig, activePreset: "custom", configError: undefined };
    });
  }, []);

  const mergeSystemStatus = useCallback((status: SystemStatus) => {
    if (configurationLocked) {
      setState((previous) => keepStoredConfigLocked(previous));
      return false;
    }
    if (Object.keys(status).length === 0) return false;
    const current = createCurrentConfig(status, config);
    if (!current.success) {
      setState((previous) => ({
        ...previous,
        configError: `无法创建当前配置：${current.errors.slice(0, 3).join("；")}`,
      }));
      return false;
    }
    setState({
      config: current.config,
      activePreset: "current",
      awaitingCurrent: false,
    });
    return true;
  }, [config, configurationLocked]);

  useEffect(() => {
    if (!awaitingCurrent || configurationLocked || !systemStatus || Object.keys(systemStatus).length === 0) return;
    mergeSystemStatus(systemStatus);
  }, [awaitingCurrent, configurationLocked, mergeSystemStatus, systemStatus]);

  const applyPreset = useCallback((preset: PresetLevel, status?: SystemStatus) => {
    if (preset === "custom") return;
    if (preset === "current") {
      if (status) mergeSystemStatus(status);
      else setState((previous) => ({ ...previous, configError: "当前配置需要可用的实时系统状态" }));
      return;
    }
    if (configurationLocked) {
      setState((previous) => keepStoredConfigLocked(previous));
      return;
    }
    setState({ config: generatePresetConfig(preset), activePreset: preset, awaitingCurrent: false });
  }, [configurationLocked, mergeSystemStatus]);

  const importConfig = useCallback((json: string, confirmLegacy = false): ImportConfigResult => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch {
      return { status: "error", error: "配置文件不是有效的 JSON" };
    }

    const current = validateConfig(parsed);
    if (current.valid && current.config) {
      clearStoredConfig();
      setState({ config: current.config, activePreset: current.config.preset, awaitingCurrent: false });
      return { status: "applied" };
    }

    const legacy = validateLegacyV1Config(parsed);
    if (!legacy.valid) {
      return {
        status: "error",
        error: `配置文件无效：${current.errors.slice(0, 3).join("；")}`,
      };
    }

    const result = convertConfig(parsed, systemStatus);
    if (!result.success) {
      return {
        status: "error",
        error: `旧版配置迁移失败，原文件未被修改：${result.errors.slice(0, 3).join("；")}`,
      };
    }
    const summary = countChanges(result.config, systemStatus);
    if (!confirmLegacy) {
      return {
        status: "preview",
        changed: summary.changed,
        highRisk: summary.highRisk,
        unavailable: summary.unavailable,
      };
    }
    clearStoredConfig();
    setState({ config: result.config, activePreset: result.config.preset, awaitingCurrent: false });
    return { status: "applied" };
  }, [systemStatus]);

  const resetExecutedCommands = useCallback(() => {
    setState((previous) => {
      if (hasStoredConfigLock(previous)) return keepStoredConfigLocked(previous);
      let nextConfig = previous.config;
      let resetAny = false;
      for (const category of categories) {
        for (const item of category.items) {
          if (item.control !== "command") continue;
          if (getCommandExecution(nextConfig, category.id, item.id) !== true) continue;
          nextConfig = setCommandExecution(nextConfig, category.id, item.id, false);
          resetAny = true;
        }
      }
      if (!resetAny) return previous;
      nextConfig.preset = "custom";
      return { ...previous, config: nextConfig, activePreset: "custom", configError: undefined };
    });
  }, []);

  const discardStoredConfig = useCallback(() => {
    clearStoredConfig();
    setState(fallbackState());
  }, []);

  const changes = countChanges(config, systemStatus);
  return {
    config,
    activePreset,
    updateTarget,
    updateCommand,
    syncCategoryToCurrent,
    toggleItem,
    applyPreset,
    importConfig,
    resetExecutedCommands,
    discardStoredConfig,
    mergeSystemStatus,
    changes,
    configError,
    categorySyncError,
    clearCategorySyncError,
    configurationLocked,
    configurationReady: !awaitingCurrent && !configurationLocked,
    pendingLegacyMigration: !!pendingLegacyConfig,
  };
}
