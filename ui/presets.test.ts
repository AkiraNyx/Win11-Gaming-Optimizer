import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "./src/lib/categories.ts";
import {
  countCategoryChanges,
  countChanges,
  generatePresetConfig,
  getCommandExecution,
  getItemTarget,
  resolveSyncedActivePreset,
  setCommandExecution,
  setItemTarget,
} from "./src/lib/presets.ts";
import type { PresetConfig } from "./src/types/optimization.ts";
import type { SystemStatus } from "./src/types/system-status.ts";

function matchingStatus(config: PresetConfig): SystemStatus {
  return Object.fromEntries(categories.map((category) => [
    category.id,
    Object.fromEntries(category.items.map((item) => [item.id, {
      kind: item.control === "command" ? "command" : item.control === "diagnostic" ? "diagnostic" : "enum",
      currentValue: item.control === "command" || item.control === "diagnostic"
        ? null
        : getItemTarget(config, category.id, item.id) ?? null,
      available: true,
      applicable: true,
      stateConsistent: true,
      description: "test",
    }])),
  ]));
}

test("setters preserve identity when the requested value is unchanged", () => {
  const config = generatePresetConfig("balanced");
  const currentTarget = getItemTarget(config, "bootOptimization", "fastStartup");
  const currentCommand = getCommandExecution(config, "bootOptimization", "bootProcessorsFull");

  assert.notEqual(currentTarget, undefined);
  assert.notEqual(currentCommand, undefined);
  assert.equal(setItemTarget(config, "bootOptimization", "fastStartup", currentTarget!), config);
  assert.equal(setCommandExecution(config, "bootOptimization", "bootProcessorsFull", currentCommand!), config);
});

test("category counts and synced preset use the same changed-state rules", () => {
  const config = generatePresetConfig("balanced");
  const status = matchingStatus(config);
  const unchangedCounts = countCategoryChanges(config, status);

  assert.equal(Object.values(unchangedCounts).reduce((sum, count) => sum + count, 0), 0);
  assert.equal(resolveSyncedActivePreset(config, status), "current");

  const currentFastStartup = getItemTarget(config, "bootOptimization", "fastStartup");
  assert.equal(typeof currentFastStartup, "boolean");
  const changed = setItemTarget(config, "bootOptimization", "fastStartup", !currentFastStartup);
  const changedCounts = countCategoryChanges(changed, status);

  assert.equal(changedCounts.bootOptimization, 1);
  assert.equal(Object.values(changedCounts).reduce((sum, count) => sum + count, 0), countChanges(changed, status).changed);
  assert.equal(resolveSyncedActivePreset(changed, status), "custom");

  status.bootOptimization.fastStartup.available = false;
  assert.equal(resolveSyncedActivePreset(changed, status), "current");
});
