import type { RuntimeCapabilities } from "@/types/runtime";
interface FooterProps { runtime: RuntimeCapabilities | null; loading: boolean; }
export function Footer({ runtime, loading }: FooterProps) {
  const version = runtime?.packageVersion ? `Dev ${runtime.packageVersion}` : "Dev …";
  const windows = runtime?.windows ? `${runtime.windows.caption} · ${runtime.windows.version}（Build ${runtime.windows.buildNumber}）` : loading ? "正在检测 Windows 版本…" : "Windows 版本未知";
  return <footer className="optimizer-footer">
    <span className="inline-flex items-center gap-2"><span className="optimizer-status-dot" />{runtime?.mutationsEnabled ? "受保护运行环境" : loading ? "正在初始化" : "只读预览"}<span className="optimizer-footer-divider">/</span><span className="font-mono">{version}</span></span>
    <span className="min-w-0 break-words">{windows}</span>
  </footer>;
}
