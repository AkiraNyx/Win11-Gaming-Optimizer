"use client";
import { createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Theme, type ThemeName } from "@arinox/react";
import { useThemeMotion } from "@/hooks/use-theme-motion";

const STORAGE_KEY = "win11-optimizer-theme";
const CHANGE_EVENT = "optimizer-theme-change";
let memoryTheme: ThemeName | undefined;
const ThemeContext = createContext({ theme: "day" as ThemeName, toggleTheme: () => {}, themeError: "" });

function readTheme(): ThemeName {
  if (memoryTheme) return memoryTheme;
  const nativeTheme = window.win11Optimizer?.getTheme?.();
  if (nativeTheme === "day" || nativeTheme === "night") return nativeTheme;
  try { return localStorage.getItem(STORAGE_KEY) === "night" ? "night" : "day"; }
  catch { return "day"; }
}
function subscribe(notify: () => void) {
  const changed = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      memoryTheme = undefined;
    }
    notify();
  };
  window.addEventListener(CHANGE_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => { window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener("storage", changed); };
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "day" as ThemeName);
  const [themeError, setThemeError] = useState("");
  const saveId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const prepareTheme = useThemeMotion(root, theme);
  const toggleTheme = () => {
    prepareTheme();
    const next = readTheme() === "day" ? "night" : "day";
    memoryTheme = next;
    const id = ++saveId.current;
    window.dispatchEvent(new Event(CHANGE_EVENT));
    const save = async () => {
      try {
        if (window.win11Optimizer?.setTheme) {
          if (!(await window.win11Optimizer.setTheme(next))) throw new Error("Theme save failed");
        } else localStorage.setItem(STORAGE_KEY, next);
        if (id === saveId.current) setThemeError("");
      } catch {
        if (id === saveId.current) setThemeError("主题未保存，仅本次会话生效");
      }
    };
    void save();
  };
  return <ThemeContext.Provider value={{ theme, toggleTheme, themeError }}>
    <Theme ref={root} theme={theme} className={`optimizer-theme ${theme === "night" ? "dark" : ""}`}>{children}</Theme>
  </ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
