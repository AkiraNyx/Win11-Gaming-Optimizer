import conservativePreset from "../../public/presets/conservative.json" with { type: "json" };
import balancedPreset from "../../public/presets/balanced.json" with { type: "json" };
import extremePreset from "../../public/presets/extreme.json" with { type: "json" };
import type { HardwareInfo } from "@/types/hardware";
import type {
  CommandItemConfig,
  ConfigPresetLevel,
  DiagnosticItemConfig,
  OptimizationItem,
  OptimizationItemConfig,
  PresetConfig,
  ServiceAction,
  TargetItemConfig,
  TargetValue,
  TransitionWarning,
} from "@/types/optimization";
import type { ItemStatus, SystemStatus } from "@/types/system-status";
import {
  categories,
  getOptimizationItem,
  isOptimizationTargetAllowed,
  isPreserveOnlyTarget,
} from "./categories.ts";
import {
  validateConfig,
  validateLegacyV1Config,
  type LegacyPresetConfig,
  type LegacyServiceItemConfig,
} from "./config-validator.ts";
import { hasFastStartupHibernationConflict } from "./config-dependencies.ts";

type BuiltInPreset = Exclude<ConfigPresetLevel, "custom">;

export function isStatusTargetBlocked(
  status: ItemStatus | null | undefined,
  target: TargetValue | undefined,
): boolean {
  if (!status?.blockedReason) return false;
  if (target === undefined || !status.blockedTargets) return true;
  return status.blockedTargets.some((blockedTarget) => Object.is(blockedTarget, target));
}

export type ConfigConversionResult =
  | { success: true; config: PresetConfig; warnings?: string[] }
  | { success: false; errors: string[] };

export type ItemChangeState = "changed" | "unchanged" | "unknown";

export interface ChangeCount {
  total: number;
  changed: number;
  warnings: number;
  highRisk: number;
  unavailable: number;
  enabled: number;
  disabled: number;
  blocked: number;
}

const presetSources: Record<BuiltInPreset, unknown> = {
  conservative: conservativePreset,
  balanced: balancedPreset,
  extreme: extremePreset,
};

const LEGACY_ENABLED_TARGETS: Record<string, TargetValue> = {
  "windowsUpdate.disableP2P": false,
  "windowsUpdate.deferQualityUpdates": 7,
  "windowsUpdate.deferFeatureUpdates": 30,
  "windowsUpdate.disableAutoDriverUpdate": false,
  "windowsUpdate.disableAutoUpdate": false,
  "bootOptimization.fastStartup": true,
  "bootOptimization.disableBootLog": false,
  "bootOptimization.reduceBootTimeout": 0,
  "bootOptimization.disableStartupSound": false,
  "taskScheduling.enableGameMode": true,
  "taskScheduling.foregroundPriority": 38,
  "taskScheduling.disableBackgroundApps": "forceDeny",
  "taskScheduling.disableGameDVR": false,
  "powerManagement.ultimatePerformancePlan": "ultimatePerformance",
  "powerManagement.minProcessorState100": 100,
  "powerManagement.disablePowerThrottling": false,
  "powerManagement.disableUsbSuspend": false,
  "powerManagement.disablePcieLpm": 0,
  "powerManagement.disableDiskAutoOff": 0,
  "powerManagement.aggressiveBoost": 2,
  "storageOptimization.disableLastAccess": 1,
  "storageOptimization.disableDot3Name": 1,
  "storageOptimization.optimizePagefile": "systemManaged",
  "storageOptimization.disableHibernation": false,
  "ssdOptimization.enableTrim": true,
  "ssdOptimization.disablePrefetch": "disabled",
  "memoryOptimization.disableMemoryCompression": false,
  "memoryOptimization.disableCrashDump": 0,
  "memoryOptimization.largeSystemCache": "desktop",
  "cpuOptimization.optimizeTimer": "platformTick",
  "cpuOptimization.disableCoreParking": 100,
  "gpuOptimization.hwSchedule": "enabled",
  "gpuOptimization.disableFullscreenOpt": false,
  "gpuOptimization.gpuPriority": 8,
  "gpuOptimization.aeroPeek": false,
  "networkOptimization.disableNagle": false,
  "networkOptimization.disableThrottling": false,
  "networkOptimization.disableBandwidthLimit": 0,
  "networkOptimization.optimizeDns": "cloudflare",
  "networkOptimization.disableNicPowerSave": "disabled",
  "uiOptimization.disableTransparency": false,
  "uiOptimization.disableAnimations": false,
  "uiOptimization.disableShadows": false,
  "uiOptimization.disableSnapAssist": false,
  "uiOptimization.disableWidgets": false,
  "uiOptimization.disableCopilot": false,
  "uiOptimization.disableNotificationCenter": false,
  "uiOptimization.performanceVisualEffects": "performance",
  "privacyOptimization.telemetryMinimal": 1,
  "privacyOptimization.disableAdId": false,
  "privacyOptimization.disableActivityHistory": false,
  "privacyOptimization.disableLocation": false,
  "privacyOptimization.disableDiagViewer": false,
  "privacyOptimization.disableSuggestions": false,
  "privacyOptimization.disableStartSuggestions": false,
  "privacyOptimization.disableCortana": false,
  "securityOptimization.optimizeScanSchedule": true,
  "securityOptimization.optimizeDEP": "OptIn",
  "securityOptimization.reduceMitigations": "reduced",
};

function loadCanonicalPreset(name: BuiltInPreset): PresetConfig {
  const result = validateConfig(presetSources[name]);
  if (!result.valid || !result.config || result.config.preset !== name) {
    throw new Error(`Invalid bundled preset: ${name} (${result.errors.join(", ")})`);
  }
  return result.config;
}

const canonicalPresets: Record<BuiltInPreset, PresetConfig> = {
  conservative: loadCanonicalPreset("conservative"),
  balanced: loadCanonicalPreset("balanced"),
  extreme: loadCanonicalPreset("extreme"),
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isTargetItemConfig(value: OptimizationItemConfig | undefined): value is TargetItemConfig {
  return !!value && hasOwn(value, "target");
}

export function isCommandItemConfig(value: OptimizationItemConfig | undefined): value is CommandItemConfig {
  return !!value && hasOwn(value, "execute");
}

export function isDiagnosticItemConfig(value: OptimizationItemConfig | undefined): value is DiagnosticItemConfig {
  return !!value && hasOwn(value, "diagnostic");
}

function optionIncludes(item: OptimizationItem, value: TargetValue): boolean {
  return isOptimizationTargetAllowed(item, value);
}

function getItemConfig(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
): OptimizationItemConfig | undefined {
  return config.categories[categoryId]?.items[itemId];
}

export function generatePresetConfig(preset: ConfigPresetLevel): PresetConfig {
  if (preset === "custom") {
    const custom = structuredClone(canonicalPresets.balanced);
    custom.preset = "custom";
    return custom;
  }
  return structuredClone(canonicalPresets[preset]);
}

export function getItemTarget(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
): TargetValue | undefined {
  const value = getItemConfig(config, categoryId, itemId);
  return isTargetItemConfig(value) ? value.target : undefined;
}

export function setItemTarget(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
  target: TargetValue,
): PresetConfig {
  const metadata = getOptimizationItem(categoryId, itemId);
  const existing = getItemConfig(config, categoryId, itemId);
  if (
    !metadata
    || (metadata.control !== "switch" && metadata.control !== "select")
    || !isTargetItemConfig(existing)
    || !optionIncludes(metadata, target)
  ) {
    return config;
  }
  if (Object.is(existing.target, target)) return config;

  const next = structuredClone(config);
  next.categories[categoryId].items[itemId] = { target };
  return next;
}

export function getCommandExecution(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
): boolean | undefined {
  const value = getItemConfig(config, categoryId, itemId);
  return isCommandItemConfig(value) ? value.execute : undefined;
}

export function setCommandExecution(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
  execute: boolean,
): PresetConfig {
  const metadata = getOptimizationItem(categoryId, itemId);
  const existing = getItemConfig(config, categoryId, itemId);
  if (!metadata || metadata.control !== "command" || !isCommandItemConfig(existing)) return config;
  if (existing.execute === execute) return config;

  const next = structuredClone(config);
  next.categories[categoryId].items[itemId] = { execute };
  return next;
}

export function getServiceItemAction(
  config: PresetConfig,
  categoryId: string,
  itemId: string,
): ServiceAction | undefined {
  if (categoryId !== "serviceOptimization") return undefined;
  const target = getItemTarget(config, categoryId, itemId);
  return typeof target === "string" && ["automaticDelayed", "automatic", "manual", "disabled"].includes(target)
    ? target as ServiceAction
    : undefined;
}

export function compareCurrentToTarget(currentValue: TargetValue, target: TargetValue): boolean {
  return Object.is(currentValue, target);
}

export function getTargetLabel(item: OptimizationItem, value: TargetValue | null): string {
  if (value === null) return "未知";
  const option = item.options?.find((candidate) => Object.is(candidate.value, value));
  if (option) return option.label;
  if (typeof value === "boolean") return value ? "启用" : "关闭";
  return String(value);
}

export function getItemChangeState(
  config: PresetConfig,
  systemStatus: SystemStatus | undefined,
  categoryId: string,
  itemId: string,
): ItemChangeState {
  const metadata = getOptimizationItem(categoryId, itemId);
  const value = getItemConfig(config, categoryId, itemId);
  if (!metadata || !value || metadata.control === "diagnostic") return "unchanged";
  if (metadata.control === "command") {
    if (!isCommandItemConfig(value)) return "unknown";
    if (!value.execute) return "unchanged";
    const status = systemStatus?.[categoryId]?.[itemId];
    if (status?.applicable === false) return "unchanged";
    if (!status?.available || status.stateConsistent === false) return "unknown";
    return "changed";
  }
  if (!isTargetItemConfig(value)) return "unknown";

  const status = systemStatus?.[categoryId]?.[itemId];
  if (status?.applicable === false) return "unchanged";
  if (!status?.available || status.stateConsistent === false || status.currentValue === null) return "unknown";
  if (!isOptimizationTargetAllowed(metadata, status.currentValue)) return "unknown";
  return compareCurrentToTarget(status.currentValue, value.target) ? "unchanged" : "changed";
}

export function getTransitionWarning(
  item: OptimizationItem,
  from: TargetValue | null,
  to: TargetValue,
): TransitionWarning | undefined {
  return item.transitionWarnings?.find((warning) => (
    Object.is(warning.to, to)
    && (warning.from === "*" || (from !== null && Object.is(warning.from, from)))
  ));
}

function statusTarget(
  systemStatus: SystemStatus | undefined,
  categoryId: string,
  item: OptimizationItem,
  errors: string[],
): TargetValue | undefined {
  const path = `categories.${categoryId}.items.${item.id}`;
  const status = systemStatus?.[categoryId]?.[item.id];
  if (
    !status?.available
    || status.applicable === false
    || status.stateConsistent === false
    || status.currentValue === null
  ) {
    errors.push(`${path} requires an available live system status`);
    return undefined;
  }
  if (!optionIncludes(item, status.currentValue)) {
    errors.push(`${path} has an unsupported current value: ${JSON.stringify(status.currentValue)}`);
    return undefined;
  }
  return status.currentValue;
}

function buildCurrentItems(
  systemStatus: SystemStatus,
  fallbackConfig: PresetConfig | undefined,
  errors: string[],
  warnings: string[],
): PresetConfig["categories"] {
  const configCategories: PresetConfig["categories"] = {};
  for (const category of categories) {
    const items: Record<string, OptimizationItemConfig> = {};
    for (const item of category.items) {
      if (item.control === "command") {
        items[item.id] = { execute: false };
      } else if (item.control === "diagnostic") {
        items[item.id] = { diagnostic: true };
      } else {
        const path = `categories.${category.id}.items.${item.id}`;
        const status = systemStatus[category.id]?.[item.id];
        if (
          status?.available
          && status.applicable !== false
          && status.stateConsistent !== false
          && status.currentValue !== null
          && optionIncludes(item, status.currentValue)
        ) {
          items[item.id] = { target: status.currentValue };
          continue;
        }

        const fallbackTarget = fallbackConfig
          ? getItemTarget(fallbackConfig, category.id, item.id)
          : undefined;
        if (fallbackTarget === undefined || !optionIncludes(item, fallbackTarget)) {
          errors.push(`${path} requires an available live status or a valid existing target`);
          continue;
        }
        items[item.id] = { target: fallbackTarget };
        warnings.push(`${path} current status is unavailable; the existing target was retained`);
      }
    }
    configCategories[category.id] = { items };
  }
  return configCategories;
}

export function createCurrentConfig(
  systemStatus: SystemStatus,
  fallbackConfig?: PresetConfig,
): ConfigConversionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const config: PresetConfig = {
    version: "2.0",
    preset: "custom",
    categories: buildCurrentItems(systemStatus, fallbackConfig, errors, warnings),
  };
  if (errors.length > 0) return { success: false, errors };

  const validation = validateConfig(config);
  return validation.valid && validation.config
    ? { success: true, config: validation.config, warnings }
    : { success: false, errors: validation.errors };
}

function legacyItemSelected(
  categoryEnabled: boolean,
  value: boolean | LegacyServiceItemConfig,
): boolean {
  return categoryEnabled && (typeof value === "boolean" ? value : value.enabled);
}

function legacyEnabledTarget(
  categoryId: string,
  item: OptimizationItem,
  legacyValue: boolean | LegacyServiceItemConfig,
): TargetValue | undefined {
  if (categoryId === "serviceOptimization" && typeof legacyValue !== "boolean") {
    return legacyValue.action;
  }
  return LEGACY_ENABLED_TARGETS[`${categoryId}.${item.id}`];
}

export function migrateLegacyV1Config(
  input: unknown,
  systemStatus?: SystemStatus,
): ConfigConversionResult {
  const legacyResult = validateLegacyV1Config(input);
  if (!legacyResult.valid || !legacyResult.config) {
    return { success: false, errors: legacyResult.errors };
  }

  const legacy: LegacyPresetConfig = legacyResult.config;
  const errors: string[] = [];
  const configCategories: PresetConfig["categories"] = {};
  for (const category of categories) {
    const legacyCategory = legacy.categories[category.id];
    const items: Record<string, OptimizationItemConfig> = {};
    for (const item of category.items) {
      const legacyValue = legacyCategory.items[item.id];
      if (item.control === "command") {
        items[item.id] = { execute: legacyItemSelected(legacyCategory.enabled, legacyValue) };
        continue;
      }
      if (item.control === "diagnostic") {
        items[item.id] = { diagnostic: true };
        continue;
      }

      const selected = legacyItemSelected(legacyCategory.enabled, legacyValue);
      const target = selected
        ? legacyEnabledTarget(category.id, item, legacyValue)
        : statusTarget(systemStatus, category.id, item, errors);
      if (target === undefined) {
        if (selected) errors.push(`categories.${category.id}.items.${item.id} has no v1 migration target`);
      } else if (!optionIncludes(item, target)) {
        errors.push(`categories.${category.id}.items.${item.id} migration target is not supported`);
      } else {
        items[item.id] = { target };
      }
    }
    configCategories[category.id] = { items };
  }

  if (errors.length > 0) return { success: false, errors };
  const migrated: PresetConfig = {
    version: "2.0",
    preset: "custom",
    categories: configCategories,
  };
  const validation = validateConfig(migrated);
  return validation.valid && validation.config
    ? { success: true, config: validation.config }
    : { success: false, errors: validation.errors };
}

export function convertConfig(
  input: unknown,
  systemStatus?: SystemStatus,
): ConfigConversionResult {
  const current = validateConfig(input);
  if (current.valid && current.config) return { success: true, config: current.config };

  const legacy = validateLegacyV1Config(input);
  if (legacy.valid) return migrateLegacyV1Config(input, systemStatus);
  return { success: false, errors: current.errors };
}

export function countChanges(
  config: PresetConfig,
  systemStatus?: SystemStatus,
): ChangeCount {
  let total = 0;
  let changed = 0;
  let warnings = 0;
  let highRisk = 0;
  let unavailable = 0;
  let enabled = 0;
  let disabled = 0;
  let blocked = 0;

  for (const category of categories) {
    for (const item of category.items) {
      if (item.control === "diagnostic") continue;
      total++;
      const state = getItemChangeState(config, systemStatus, category.id, item.id);
      if (state === "unknown") {
        unavailable++;
        continue;
      }
      if (state !== "changed") continue;
      changed++;

      const value = getItemConfig(config, category.id, item.id);
      const itemStatus = systemStatus?.[category.id]?.[item.id];
      if (isCommandItemConfig(value)) {
        if (isStatusTargetBlocked(itemStatus, value.execute)) blocked++;
        const warning = getTransitionWarning(item, null, value.execute);
        if (warning) {
          warnings++;
          if (warning.severity === "high") highRisk++;
        }
      } else if (isTargetItemConfig(value)) {
        const currentValue = systemStatus?.[category.id]?.[item.id]?.currentValue ?? null;
        const warning = getTransitionWarning(item, currentValue, value.target);
        if (warning) {
          warnings++;
          if (warning.severity === "high") highRisk++;
        }
        if (isStatusTargetBlocked(itemStatus, value.target) || (
          currentValue !== null
          && isPreserveOnlyTarget(item, value.target)
          && !compareCurrentToTarget(currentValue, value.target)
        )) {
          blocked++;
        }
        if (value.target === false || value.target === "disabled") disabled++;
        if (value.target === true || value.target === "enabled") enabled++;
      }
    }
  }
  if (hasFastStartupHibernationConflict(config)) blocked++;
  return { total, changed, warnings, highRisk, unavailable, enabled, disabled, blocked };
}

export function countCategoryChanges(
  config: PresetConfig,
  systemStatus?: SystemStatus,
): Record<string, number> {
  return Object.fromEntries(categories.map((category) => [
    category.id,
    category.items.reduce((count, item) => (
      count + (getItemChangeState(config, systemStatus, category.id, item.id) === "changed" ? 1 : 0)
    ), 0),
  ]));
}

export function resolveSyncedActivePreset(
  config: PresetConfig,
  systemStatus?: SystemStatus,
): "current" | "custom" {
  return countChanges(config, systemStatus).changed === 0 ? "current" : "custom";
}

export function compactHardwareInfo(hardware?: HardwareInfo): Partial<HardwareInfo> | undefined {
  if (!hardware) return undefined;
  const compact: Partial<HardwareInfo> = {};
  if (hardware.hasSSD || hardware.hasHDD) {
    compact.hasSSD = hardware.hasSSD;
    compact.hasHDD = hardware.hasHDD;
  }
  if (hardware.ramGB > 0) compact.ramGB = hardware.ramGB;
  if (hardware.cpuCores > 0) compact.cpuCores = hardware.cpuCores;
  if (hardware.cpuName && hardware.cpuName !== "未知 CPU") compact.cpuName = hardware.cpuName;
  if (hardware.gpuName && hardware.gpuName !== "未知 GPU" && hardware.gpuName !== "Unknown") compact.gpuName = hardware.gpuName;
  if (hardware.gpuBrand !== "Unknown") compact.gpuBrand = hardware.gpuBrand;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function exportToJSON(config: PresetConfig, hardware?: HardwareInfo): string {
  const knownHardware = compactHardwareInfo(hardware);
  const exportConfig = {
    ...config,
    exportedAt: new Date().toISOString(),
    ...(knownHardware ? { hardware: knownHardware } : {}),
  };
  return JSON.stringify(exportConfig, null, 2);
}
