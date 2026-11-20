import type { CleanupRisk } from "@/types/cleanup";

export interface CleanupGroupMeta {
  id: string;
  label: string;
  description: string;
}

/**
 * Display order and copy for cleanup groups. Ids must match
 * scripts/cleanup/CleanupCatalog.psm1; the engine is authoritative for the
 * targets themselves, this list only controls how they are grouped.
 */
export const cleanupGroups: readonly CleanupGroupMeta[] = [
  { id: "windows-update", label: "Windows 更新与日志", description: "已安装更新的下载缓存、更新编排器日志与组件安装日志" },
  { id: "system-temp", label: "系统临时文件", description: "系统临时目录、错误报告与崩溃转储" },
  { id: "app-updaters", label: "软件更新包", description: "Squirrel / Electron 更新器留下的待安装包与安装器副本" },
  { id: "dev-caches", label: "开发工具缓存", description: "pip / npm / pnpm / Playwright / Arduino 的下载缓存" },
  { id: "browser-cache", label: "浏览器与着色器", description: "浏览器页面缓存、缩略图缓存与显卡着色器缓存" },
  { id: "user-files", label: "回收站与安装包", description: "回收站内容，以及 Downloads 中大安装包的只读盘点" },
  { id: "inventory", label: "只读盘点", description: "组件存储与驱动仓库占用，仅显示并给出官方清理方式" },
];

export const cleanupGroupOrder: readonly string[] = cleanupGroups.map((group) => group.id);

export function getCleanupGroup(id: string): CleanupGroupMeta {
  return cleanupGroups.find((group) => group.id === id) ?? {
    id,
    label: "其他",
    description: "",
  };
}

export interface RiskMeta {
  label: string;
  hint: string;
  variant: "outline" | "secondary" | "destructive";
}

export function getRiskMeta(risk: CleanupRisk): RiskMeta {
  switch (risk) {
    case "safe":
      return { label: "可安全清理", hint: "由系统或应用自动重建，不影响功能", variant: "outline" };
    case "medium":
      return { label: "需要重下", hint: "删除后需要重新下载或重新编译，短期会变慢", variant: "secondary" };
    case "caution":
      return { label: "谨慎", hint: "删除后不可恢复，可能丢失用户内容", variant: "destructive" };
    default:
      return { label: "仅盘点", hint: "只读统计，本工具不会删除", variant: "outline" };
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat("zh-CN").format(count);
}
