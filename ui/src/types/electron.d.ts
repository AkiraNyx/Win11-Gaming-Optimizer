interface Win11OptimizerStartupState {
  kind: "progress" | "error";
  id?: "loading-service" | "starting-service" | "initializing-runtime" | "reading-system-status";
  label: string;
  detail?: string;
  current?: number;
  total?: number;
}

interface Win11OptimizerWindowApi {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  onMaximizeChange: (listener: (maximized: boolean) => void) => () => void;
  onStartupState: (listener: (state: Win11OptimizerStartupState) => void) => () => void;
}

interface Window {
  win11Optimizer?: Win11OptimizerWindowApi;
}
