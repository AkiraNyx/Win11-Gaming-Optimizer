import type {
  ConfigPresetLevel,
  PresetConfig,
  ServiceAction,
  TargetValue,
} from "@/types/optimization";
import { categories, isOptimizationTargetAllowed } from "./categories.ts";

const PRESETS = new Set<ConfigPresetLevel>([
  "conservative",
  "balanced",
  "extreme",
  "custom",
]);

export const CATEGORY_ITEMS: Record<string, readonly string[]> = Object.fromEntries(
  categories.map((category) => [category.id, category.items.map((item) => item.id)]),
);

type UnknownObject = Record<string, unknown>;

export interface LegacyServiceItemConfig {
  enabled: boolean;
  action: Extract<ServiceAction, "manual" | "disabled">;
}

export interface LegacyPresetConfig {
  version: "1.0";
  preset: ConfigPresetLevel;
  categories: Record<string, {
    enabled: boolean;
    items: Record<string, boolean | LegacyServiceItemConfig>;
  }>;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  config?: PresetConfig;
}

export interface LegacyConfigValidationResult {
  valid: boolean;
  errors: string[];
  config?: LegacyPresetConfig;
}

function isPlainObject(value: unknown): value is UnknownObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: UnknownObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeAeroPeekItemName(config: UnknownObject): UnknownObject {
  const configCategories = config.categories;
  if (!isPlainObject(configCategories)) return config;
  const gpuOptimization = configCategories.gpuOptimization;
  if (!isPlainObject(gpuOptimization) || !isPlainObject(gpuOptimization.items)) return config;
  if (!hasOwn(gpuOptimization.items, "disableDWM") || hasOwn(gpuOptimization.items, "aeroPeek")) return config;

  const normalized = structuredClone(config);
  const normalizedCategories = normalized.categories as UnknownObject;
  const normalizedGpu = normalizedCategories.gpuOptimization as UnknownObject;
  const normalizedItems = normalizedGpu.items as UnknownObject;
  normalizedItems.aeroPeek = normalizedItems.disableDWM;
  delete normalizedItems.disableDWM;
  return normalized;
}

function validateExactKeys(
  value: UnknownObject,
  expectedKeys: readonly string[],
  location: string,
  errors: string[],
): void {
  for (const key of expectedKeys) {
    if (!hasOwn(value, key)) errors.push(`${location}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) errors.push(`${location}.${key} is not allowed`);
  }
}

function validateHardware(hardware: unknown, errors: string[]): void {
  if (!isPlainObject(hardware)) {
    errors.push("hardware must be an object");
    return;
  }

  const allowedKeys = ["hasSSD", "hasHDD", "ramGB", "cpuCores", "cpuName", "gpuName", "gpuBrand"];
  for (const key of Object.keys(hardware)) {
    if (!allowedKeys.includes(key)) errors.push(`hardware.${key} is not allowed`);
  }
  for (const key of ["hasSSD", "hasHDD"] as const) {
    if (hasOwn(hardware, key) && typeof hardware[key] !== "boolean") {
      errors.push(`hardware.${key} must be a boolean`);
    }
  }
  for (const key of ["ramGB", "cpuCores"] as const) {
    const value = hardware[key];
    if (hasOwn(hardware, key) && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
      errors.push(`hardware.${key} must be a positive integer`);
    }
  }
  for (const key of ["cpuName", "gpuName"] as const) {
    if (hasOwn(hardware, key) && typeof hardware[key] !== "string") {
      errors.push(`hardware.${key} must be a string`);
    }
  }
  if (
    hasOwn(hardware, "gpuBrand")
    && !["NVIDIA", "AMD", "Intel", "Unknown"].includes(hardware.gpuBrand as string)
  ) {
    errors.push("hardware.gpuBrand is invalid");
  }
}

function validateRoot(config: UnknownObject, version: "1.0" | "2.0", errors: string[]): void {
  const allowedRootKeys = ["version", "preset", "categories", "exportedAt", "hardware"];
  for (const key of Object.keys(config)) {
    if (!allowedRootKeys.includes(key)) errors.push(`${key} is not allowed`);
  }
  if (config.version !== version) errors.push(`version must be ${version}`);
  if (typeof config.preset !== "string" || !PRESETS.has(config.preset as ConfigPresetLevel)) {
    errors.push("preset is invalid");
  }
  if (
    hasOwn(config, "exportedAt")
    && (typeof config.exportedAt !== "string" || Number.isNaN(Date.parse(config.exportedAt)))
  ) {
    errors.push("exportedAt must be an ISO date-time string");
  }
  if (hasOwn(config, "hardware")) validateHardware(config.hardware, errors);
}

function isTargetValue(value: unknown): value is TargetValue {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function normalizeConfig(config: UnknownObject): PresetConfig {
  return {
    version: "2.0",
    preset: config.preset as ConfigPresetLevel,
    categories: structuredClone(config.categories as PresetConfig["categories"]),
  };
}

export function validateConfig(config: unknown): ConfigValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(config)) {
    return { valid: false, errors: ["config must be an object"] };
  }
  const normalizedConfig = normalizeAeroPeekItemName(config);

  validateRoot(normalizedConfig, "2.0", errors);
  if (!isPlainObject(normalizedConfig.categories)) {
    errors.push("categories must be an object");
    return { valid: false, errors };
  }

  validateExactKeys(normalizedConfig.categories, categories.map((category) => category.id), "categories", errors);
  for (const categoryMetadata of categories) {
    const categoryPath = `categories.${categoryMetadata.id}`;
    const category = normalizedConfig.categories[categoryMetadata.id];
    if (!isPlainObject(category)) {
      errors.push(`${categoryPath} must be an object`);
      continue;
    }

    validateExactKeys(category, ["items"], categoryPath, errors);
    if (!isPlainObject(category.items)) {
      errors.push(`${categoryPath}.items must be an object`);
      continue;
    }

    validateExactKeys(category.items, categoryMetadata.items.map((item) => item.id), `${categoryPath}.items`, errors);
    for (const itemMetadata of categoryMetadata.items) {
      const itemPath = `${categoryPath}.items.${itemMetadata.id}`;
      const item = category.items[itemMetadata.id];
      if (!isPlainObject(item)) {
        errors.push(`${itemPath} must be an object`);
        continue;
      }

      if (itemMetadata.control === "switch" || itemMetadata.control === "select") {
        validateExactKeys(item, ["target"], itemPath, errors);
        if (!isTargetValue(item.target)) {
          errors.push(`${itemPath}.target must be a boolean, number, or string`);
        } else if (itemMetadata.control === "switch" && typeof item.target !== "boolean") {
          errors.push(`${itemPath}.target must be a boolean`);
        } else if (!isOptimizationTargetAllowed(itemMetadata, item.target)) {
          errors.push(`${itemPath}.target is not an allowed option`);
        }
      } else if (itemMetadata.control === "command") {
        validateExactKeys(item, ["execute"], itemPath, errors);
        if (typeof item.execute !== "boolean") errors.push(`${itemPath}.execute must be a boolean`);
      } else {
        validateExactKeys(item, ["diagnostic"], itemPath, errors);
        if (item.diagnostic !== true) errors.push(`${itemPath}.diagnostic must be true`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors, config: normalizeConfig(normalizedConfig) };
}

export function validateLegacyV1Config(config: unknown): LegacyConfigValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(config)) {
    return { valid: false, errors: ["config must be an object"] };
  }
  const normalizedConfig = normalizeAeroPeekItemName(config);

  validateRoot(normalizedConfig, "1.0", errors);
  if (!isPlainObject(normalizedConfig.categories)) {
    errors.push("categories must be an object");
    return { valid: false, errors };
  }

  validateExactKeys(normalizedConfig.categories, categories.map((category) => category.id), "categories", errors);
  for (const categoryMetadata of categories) {
    const categoryPath = `categories.${categoryMetadata.id}`;
    const category = normalizedConfig.categories[categoryMetadata.id];
    if (!isPlainObject(category)) {
      errors.push(`${categoryPath} must be an object`);
      continue;
    }

    validateExactKeys(category, ["enabled", "items"], categoryPath, errors);
    if (typeof category.enabled !== "boolean") errors.push(`${categoryPath}.enabled must be a boolean`);
    if (!isPlainObject(category.items)) {
      errors.push(`${categoryPath}.items must be an object`);
      continue;
    }

    validateExactKeys(category.items, categoryMetadata.items.map((item) => item.id), `${categoryPath}.items`, errors);
    for (const itemMetadata of categoryMetadata.items) {
      const itemPath = `${categoryPath}.items.${itemMetadata.id}`;
      const item = category.items[itemMetadata.id];
      if (categoryMetadata.id === "serviceOptimization") {
        if (!isPlainObject(item)) {
          errors.push(`${itemPath} must be an object`);
          continue;
        }
        validateExactKeys(item, ["enabled", "action"], itemPath, errors);
        if (typeof item.enabled !== "boolean") errors.push(`${itemPath}.enabled must be a boolean`);
        if (item.action !== "manual" && item.action !== "disabled") {
          errors.push(`${itemPath}.action is invalid`);
        }
      } else if (typeof item !== "boolean") {
        errors.push(`${itemPath} must be a boolean`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors,
    config: structuredClone(normalizedConfig) as unknown as LegacyPresetConfig,
  };
}

export function isLegacyV1Config(config: unknown): config is LegacyPresetConfig {
  return validateLegacyV1Config(config).valid;
}

export function parseConfig(json: string): ConfigValidationResult {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (isLegacyV1Config(parsed)) {
      return { valid: false, errors: ["version 1.0 requires migration with live system status"] };
    }
    return validateConfig(parsed);
  } catch {
    return { valid: false, errors: ["JSON is invalid"] };
  }
}
