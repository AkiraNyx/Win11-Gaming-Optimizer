const PRESETS = new Set(["conservative", "balanced", "extreme", "custom"]);

const CATEGORY_ITEMS = {
  windowsUpdate: ["disableP2P", "deferQualityUpdates", "deferFeatureUpdates", "disableAutoDriverUpdate", "disableAutoUpdate"],
  bootOptimization: ["fastStartup", "disableBootLog", "reduceBootTimeout", "disableStartupSound", "bootProcessorsFull"],
  taskScheduling: ["enableGameMode", "foregroundPriority", "disableBackgroundApps", "disableGameDVR"],
  serviceOptimization: ["telemetry", "fax", "remoteRegistry", "errorReporting", "printSpooler", "sysMain", "windowsSearch", "xboxAuth", "xboxGameSave", "xboxNetwork", "xboxGip", "diagHub", "bluetooth"],
  powerManagement: ["ultimatePerformancePlan", "minProcessorState100", "disablePowerThrottling", "disableUsbSuspend", "disablePcieLpm", "disableDiskAutoOff", "aggressiveBoost"],
  storageOptimization: ["disableLastAccess", "disableDot3Name", "optimizePagefile", "disableSearchIndex", "disableNtfsLog", "disableHibernation"],
  ssdOptimization: ["enableTrim", "disableDefrag", "disablePrefetch", "enableWriteCache", "checkAhci"],
  memoryOptimization: ["disableMemoryCompression", "disableCrashDump", "largeSystemCache"],
  cpuOptimization: ["optimizeTimer", "disableHPET", "disableCoreParking"],
  gpuOptimization: ["hwSchedule", "disableFullscreenOpt", "gpuPriority", "aeroPeek", "nvidiaOptimize", "amdOptimize"],
  networkOptimization: ["disableNagle", "disableThrottling", "optimizeTcp", "disableBandwidthLimit", "optimizeDns", "disableDeliveryOpt", "disableNicPowerSave"],
  uiOptimization: ["disableTransparency", "disableAnimations", "disableShadows", "disableSnapAssist", "disableWidgets", "disableCopilot", "disableNotificationCenter", "performanceVisualEffects"],
  privacyOptimization: ["telemetryMinimal", "disableAdId", "disableActivityHistory", "disableLocation", "disableDiagViewer", "disableSuggestions", "disableStartSuggestions", "disableCortana"],
  securityOptimization: ["defenderExclusions", "optimizeScanSchedule", "optimizeDEP", "reduceMitigations"],
};

const COMMAND_ITEMS = new Set([
  "bootOptimization.bootProcessorsFull",
  "cpuOptimization.disableHPET",
  "gpuOptimization.nvidiaOptimize",
  "gpuOptimization.amdOptimize",
  "securityOptimization.defenderExclusions",
]);

const DIAGNOSTIC_ITEMS = new Set([
  "storageOptimization.disableSearchIndex",
  "storageOptimization.disableNtfsLog",
  "ssdOptimization.disableDefrag",
  "ssdOptimization.enableWriteCache",
  "ssdOptimization.checkAhci",
  "networkOptimization.optimizeTcp",
  "networkOptimization.disableDeliveryOpt",
]);

const INTEGER_RANGES = {
  "windowsUpdate.deferQualityUpdates": [0, 365, true],
  "windowsUpdate.deferFeatureUpdates": [0, 3650, true],
  "bootOptimization.reduceBootTimeout": [0, 999, true],
  "taskScheduling.foregroundPriority": [0, 63, true],
  "powerManagement.minProcessorState100": [0, 100, false],
  "powerManagement.disableDiskAutoOff": [0, 86400, false],
  "storageOptimization.disableLastAccess": [0, 3, false],
  "storageOptimization.disableDot3Name": [0, 3, false],
  "cpuOptimization.disableCoreParking": [0, 100, false],
  "gpuOptimization.gpuPriority": [0, 31, true],
  "networkOptimization.disableBandwidthLimit": [0, 100, true],
};

const ENUM_TARGETS = {
  "taskScheduling.disableBackgroundApps": ["userControl", "forceAllow", "forceDeny"],
  "powerManagement.disablePcieLpm": [0, 1, 2],
  "powerManagement.aggressiveBoost": [0, 1, 2, 3, 4],
  "storageOptimization.optimizePagefile": ["systemManaged", "custom", "disabled"],
  "ssdOptimization.disablePrefetch": ["systemDefault", "enabled", "disabled", "custom"],
  "memoryOptimization.disableCrashDump": ["systemDefault", 0, 1, 2, 3, 7],
  "memoryOptimization.largeSystemCache": ["desktop", "server"],
  "cpuOptimization.optimizeTimer": ["systemDefault", "platformTick", "custom"],
  "gpuOptimization.hwSchedule": ["systemDefault", "enabled", "disabled", "custom"],
  "networkOptimization.optimizeDns": ["automatic", "cloudflare", "custom"],
  "networkOptimization.disableNicPowerSave": ["enabled", "disabled", "mixed"],
  "uiOptimization.performanceVisualEffects": ["systemDefault", "appearance", "performance", "custom"],
  "privacyOptimization.telemetryMinimal": ["systemDefault", 0, 1, 2, 3],
  "securityOptimization.optimizeDEP": ["systemDefault", "OptIn", "OptOut", "AlwaysOn", "AlwaysOff"],
  "securityOptimization.reduceMitigations": ["systemDefault", "reduced"],
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateExactKeys(value, expectedKeys, location, errors) {
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) errors.push(`${location}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) errors.push(`${location}.${key} is not allowed`);
  }
}

function validateHardware(hardware, errors) {
  if (!isPlainObject(hardware)) {
    errors.push("hardware must be an object");
    return;
  }
  const allowedKeys = ["hasSSD", "hasHDD", "ramGB", "cpuCores", "cpuName", "gpuName", "gpuBrand"];
  for (const key of Object.keys(hardware)) {
    if (!allowedKeys.includes(key)) errors.push(`hardware.${key} is not allowed`);
  }
  for (const key of ["hasSSD", "hasHDD"]) {
    if (Object.hasOwn(hardware, key) && typeof hardware[key] !== "boolean") errors.push(`hardware.${key} must be a boolean`);
  }
  for (const key of ["ramGB", "cpuCores"]) {
    if (Object.hasOwn(hardware, key) && (!Number.isInteger(hardware[key]) || hardware[key] < 1)) errors.push(`hardware.${key} must be a positive integer`);
  }
  for (const key of ["cpuName", "gpuName"]) {
    if (Object.hasOwn(hardware, key) && typeof hardware[key] !== "string") errors.push(`hardware.${key} must be a string`);
  }
  if (Object.hasOwn(hardware, "gpuBrand") && !["NVIDIA", "AMD", "Intel", "Unknown"].includes(hardware.gpuBrand)) {
    errors.push("hardware.gpuBrand is invalid");
  }
}

function validateTarget(qualifiedName, target, location, errors) {
  if (qualifiedName.startsWith("serviceOptimization.")) {
    if (!["automatic", "automaticDelayed", "manual", "disabled"].includes(target)) errors.push(`${location}.target is invalid`);
    return;
  }
  if (qualifiedName === "powerManagement.ultimatePerformancePlan") {
    if (!["ultimatePerformance", "balanced"].includes(target) && !(typeof target === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(target))) {
      errors.push(`${location}.target is invalid`);
    }
    return;
  }
  const range = INTEGER_RANGES[qualifiedName];
  if (range) {
    if (qualifiedName === "gpuOptimization.gpuPriority" && target === "custom") return;
    if (range[2] && target === "systemDefault") return;
    if (!Number.isInteger(target) || target < range[0] || target > range[1]) errors.push(`${location}.target is outside the allowed range`);
    return;
  }
  const allowed = ENUM_TARGETS[qualifiedName];
  if (allowed) {
    if (!allowed.includes(target)) errors.push(`${location}.target is invalid`);
    return;
  }
  if (typeof target !== "boolean") errors.push(`${location}.target must be a boolean`);
}

function validateConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: ["config must be an object"] };
  const allowedRootKeys = ["version", "preset", "categories", "exportedAt", "hardware"];
  for (const key of Object.keys(config)) {
    if (!allowedRootKeys.includes(key)) errors.push(`${key} is not allowed`);
  }
  if (config.version !== "2.0") errors.push("version must be 2.0");
  if (!PRESETS.has(config.preset)) errors.push("preset is invalid");
  if (Object.hasOwn(config, "exportedAt") && (typeof config.exportedAt !== "string" || Number.isNaN(Date.parse(config.exportedAt)))) {
    errors.push("exportedAt must be an ISO date-time string");
  }
  if (Object.hasOwn(config, "hardware")) validateHardware(config.hardware, errors);
  if (!isPlainObject(config.categories)) {
    errors.push("categories must be an object");
    return { valid: false, errors };
  }

  validateExactKeys(config.categories, Object.keys(CATEGORY_ITEMS), "categories", errors);
  for (const [categoryId, itemIds] of Object.entries(CATEGORY_ITEMS)) {
    const categoryPath = `categories.${categoryId}`;
    const category = config.categories[categoryId];
    if (!isPlainObject(category)) {
      errors.push(`${categoryPath} must be an object`);
      continue;
    }
    validateExactKeys(category, ["items"], categoryPath, errors);
    if (!isPlainObject(category.items)) {
      errors.push(`${categoryPath}.items must be an object`);
      continue;
    }
    validateExactKeys(category.items, itemIds, `${categoryPath}.items`, errors);
    for (const itemId of itemIds) {
      const qualifiedName = `${categoryId}.${itemId}`;
      const location = `${categoryPath}.items.${itemId}`;
      const item = category.items[itemId];
      if (!isPlainObject(item)) {
        errors.push(`${location} must be an object`);
        continue;
      }
      if (COMMAND_ITEMS.has(qualifiedName)) {
        validateExactKeys(item, ["execute"], location, errors);
        if (typeof item.execute !== "boolean") errors.push(`${location}.execute must be a boolean`);
      } else if (DIAGNOSTIC_ITEMS.has(qualifiedName)) {
        validateExactKeys(item, ["diagnostic"], location, errors);
        if (item.diagnostic !== true) errors.push(`${location}.diagnostic must be true`);
      } else {
        validateExactKeys(item, ["target"], location, errors);
        validateTarget(qualifiedName, item.target, location, errors);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { CATEGORY_ITEMS, validateConfig, validateHardware };
