export type RuntimeInitializationState = "initializing" | "ready" | "error";

export interface WindowsRuntimeInfo {
  caption: string;
  version: string;
  buildNumber: string;
}

export interface RuntimeCapabilities {
  state: RuntimeInitializationState;
  administrator: boolean;
  secureRuntime: boolean;
  supportedWindows11: boolean;
  mutationsEnabled: boolean;
  packageVersion: string;
  windows: WindowsRuntimeInfo | null;
  error?: string;
}

export type RestoreAvailabilityState = "loading" | "available" | "empty" | "error";
