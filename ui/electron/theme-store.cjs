"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createThemeStore(file) {
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid UI preferences");
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  };
  return {
    get() {
      try { return read().theme === "night" ? "night" : "day"; }
      catch { return "day"; }
    },
    set(theme) {
      if (theme !== "day" && theme !== "night") throw new Error("Invalid theme");
      const data = read();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ ...data, theme }) + "\n", { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    },
  };
}

module.exports = { createThemeStore };
