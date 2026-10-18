"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Theme, type ThemeName } from "@arinox/react";

const ThemeContext = createContext({ theme: "day" as ThemeName, toggleTheme: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>("day");
  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(value => value === "day" ? "night" : "day") }}>
    <Theme theme={theme} className={`optimizer-theme ${theme === "night" ? "dark" : ""}`}>{children}</Theme>
  </ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
