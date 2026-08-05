import type { HardwareInfo } from "./hardware";

export type SafetyLevel = "conservative" | "balanced" | "extreme";
export type ItemControl = "switch" | "select" | "command" | "diagnostic";
export type TargetValue = boolean | number | string;
export type ServiceAction = "automaticDelayed" | "automatic" | "manual" | "disabled";

export interface OptimizationOption {
  value: TargetValue;
  label: string;
  preserveOnly?: boolean;
}

export interface TransitionWarning {
  from: TargetValue | "*";
  to: TargetValue;
  message: string;
  severity: "medium" | "high";
}

export interface OptimizationItem {
  id: string;
  name: string;
  description: string;
  safetyLevel: SafetyLevel;
  control: ItemControl;
  options?: readonly OptimizationOption[];
  targetRange?: { min: number; max: number };
  targetPattern?: string;
  transitionWarnings?: readonly TransitionWarning[];
  requiresHardware?: {
    type: "ssd" | "ram" | "gpu" | "nic";
    condition: string;
  };
}

export interface OptimizationCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  items: OptimizationItem[];
}

export type ConfigPresetLevel = "conservative" | "balanced" | "extreme" | "custom";
export type PresetLevel = "current" | ConfigPresetLevel;

export interface TargetItemConfig {
  target: TargetValue;
}

export interface CommandItemConfig {
  execute: boolean;
}

export interface DiagnosticItemConfig {
  diagnostic: true;
}

export type OptimizationItemConfig = TargetItemConfig | CommandItemConfig | DiagnosticItemConfig;

export interface PresetConfig {
  version: "2.0";
  preset: ConfigPresetLevel;
  categories: Record<string, {
    items: Record<string, OptimizationItemConfig>;
  }>;
}

export type { HardwareInfo } from "./hardware";

export interface PreOptimizeSnapshot {
  timestamp: string;
  preset: PresetLevel;
  hardware?: Partial<HardwareInfo>;
  config: PresetConfig;
}

export interface SnapshotMeta {
  timestamp: string;
  preset: PresetLevel;
  hardwareSummary?: string;
  fileName: string;
}
