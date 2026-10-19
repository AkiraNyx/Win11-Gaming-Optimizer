"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createThemeStore } = require("./theme-store.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimizer-theme-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, "ui-theme.json");
}

test("native theme survives a new store and preserves other preference fields", t => {
  const file = fixture(t);
  fs.writeFileSync(file, JSON.stringify({ unrelated: "keep", theme: "day" }));
  const store = createThemeStore(file);
  store.set("night");
  assert.equal(createThemeStore(file).get(), "night");
  assert.equal(JSON.parse(fs.readFileSync(file)).unrelated, "keep");
  store.set("day");
  assert.equal(createThemeStore(file).get(), "day");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["ui-theme.json"]);
});

test("invalid UI preferences and invalid theme inputs are never overwritten", t => {
  const file = fixture(t), store = createThemeStore(file);
  assert.equal(store.get(), "day");
  assert.throws(() => store.set("other"), /Invalid theme/);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, "{preserve-broken-preferences");
  assert.equal(store.get(), "day");
  assert.throws(() => store.set("night"));
  assert.equal(fs.readFileSync(file, "utf8"), "{preserve-broken-preferences");
});
