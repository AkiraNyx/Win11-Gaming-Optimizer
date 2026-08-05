import type { RuntimeCapabilities } from "@/types/runtime";

interface FooterProps {
  runtime: RuntimeCapabilities | null;
  loading: boolean;
}

export function Footer({ runtime, loading }: FooterProps) {
  const versionLabel = runtime?.packageVersion ? `Dev ${runtime.packageVersion}` : "Dev …";
  const windowsLabel = runtime?.windows
    ? `${runtime.windows.caption} · ${runtime.windows.version}（Build ${runtime.windows.buildNumber}）`
    : loading ? "正在检测 Windows 版本…" : "Windows 版本未知";

  return (
    <footer className="flex shrink-0 flex-col gap-1 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
      <span>Win11 Optimizer · <span className="font-mono">{versionLabel}</span></span>
      <span className="min-w-0 break-words sm:text-right">{windowsLabel}</span>
    </footer>
  );
}
