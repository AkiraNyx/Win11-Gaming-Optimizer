import assert from "node:assert/strict";
import test from "node:test";
import {
  getFastStartupDependencyBlock,
  hasFastStartupHibernationConflict,
} from "./src/lib/config-dependencies.ts";
import type { PresetConfig } from "./src/types/optimization.ts";

function config(fastStartup: boolean, hibernation: boolean): PresetConfig {
  return {
    version: "2.0",
    preset: "custom",
    categories: {
      bootOptimization: { items: { fastStartup: { target: fastStartup } } },
      storageOptimization: { items: { disableHibernation: { target: hibernation } } },
    },
  };
}

test("fast startup and hibernation dependency", () => {
  const bothDisabled = config(false, false);
  assert.equal(hasFastStartupHibernationConflict(bothDisabled), false);
  assert.equal(getFastStartupDependencyBlock(bothDisabled, "bootOptimization", "fastStartup", true)?.conflict, false);
  assert.equal(getFastStartupDependencyBlock(bothDisabled, "storageOptimization", "disableHibernation", true), undefined);

  const bothEnabled = config(true, true);
  assert.equal(hasFastStartupHibernationConflict(bothEnabled), false);
  assert.equal(getFastStartupDependencyBlock(bothEnabled, "storageOptimization", "disableHibernation", false)?.conflict, false);
  assert.equal(getFastStartupDependencyBlock(bothEnabled, "bootOptimization", "fastStartup", false), undefined);

  const fastStartupDisabled = config(false, true);
  assert.equal(hasFastStartupHibernationConflict(fastStartupDisabled), false);
  assert.equal(getFastStartupDependencyBlock(fastStartupDisabled, "bootOptimization", "fastStartup", true), undefined);

  const conflict = config(true, false);
  assert.equal(hasFastStartupHibernationConflict(conflict), true);
  assert.equal(getFastStartupDependencyBlock(conflict, "bootOptimization", "fastStartup", true)?.conflict, true);
  assert.equal(getFastStartupDependencyBlock(conflict, "storageOptimization", "disableHibernation", false)?.conflict, true);
  assert.equal(getFastStartupDependencyBlock(conflict, "bootOptimization", "fastStartup", false), undefined);
  assert.equal(getFastStartupDependencyBlock(conflict, "storageOptimization", "disableHibernation", true), undefined);
});
