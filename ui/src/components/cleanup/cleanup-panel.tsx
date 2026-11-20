"use client";

import { useMemo } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cleanupGroupOrder,
  getCleanupGroup,
  getRiskMeta,
  formatBytes,
  formatCount,
} from "@/lib/cleanup";
import type { CleanupScan, CleanupTarget } from "@/types/cleanup";

interface CleanupPanelProps {
  scan: CleanupScan | null;
  loading: boolean;
  error: string | null;
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  onSelectSafe: () => void;
  onSelectNone: () => void;
  onRefresh: () => void;
  onApply: () => void;
  applyCount: number;
  applyBytes: number;
  applyDisabled: boolean;
  applyDisabledReason?: string;
  disabled?: boolean;
}

function isSelectable(target: CleanupTarget): boolean {
  return target.available && target.kind !== "report" && target.bytes >= 0;
}

export function CleanupPanel({
  scan,
  loading,
  error,
  selected,
  onToggle,
  onSelectSafe,
  onSelectNone,
  onRefresh,
  onApply,
  applyCount,
  applyBytes,
  applyDisabled,
  applyDisabledReason,
  disabled = false,
}: CleanupPanelProps) {
  const groups = useMemo(() => {
    const map = new Map<string, CleanupTarget[]>();
    for (const target of scan?.targets ?? []) {
      const bucket = map.get(target.group);
      if (bucket) bucket.push(target);
      else map.set(target.group, [target]);
    }
    return cleanupGroupOrder
      .filter((id) => map.has(id))
      .map((id) => ({ meta: getCleanupGroup(id), targets: map.get(id) ?? [] }));
  }, [scan]);

  const summary = useMemo(() => {
    const targets = scan?.targets ?? [];
    const reclaimable = targets.filter((target) => target.kind !== "report" && target.available);
    const blocked = targets.filter((target) => !target.available).length;
    const selectedBytes = targets
      .filter((target) => selected.has(target.id))
      .reduce((sum, target) => sum + target.bytes, 0);
    return {
      reclaimableBytes: reclaimable.reduce((sum, target) => sum + target.bytes, 0),
      selectedBytes,
      blocked,
      availableCount: reclaimable.filter((target) => target.bytes > 0).length,
    };
  }, [scan, selected]);

  return (
    <section aria-labelledby="cleanup-heading" className="cleanup-section">
      <div className="optimizer-category-header cleanup-header">
        <div className="min-w-0">
          <span className="optimizer-eyebrow">
            磁盘空间 / {scan ? `${String(scan.targets.length).padStart(2, "0")} 个位置` : "尚未扫描"}
          </span>
          <h3 id="cleanup-heading" className="cleanup-heading">
            <Trash2 className="size-5" aria-hidden="true" />空间清理
          </h3>
          <p>
            扫描临时缓存、软件更新包与可回收文件。删除只针对下方声明的固定位置，不触碰任何其他目录；清理不可撤销，也不进入优化回滚记录。
          </p>
        </div>
        <div className="optimizer-category-actions">
          <Button variant="ghost" size="sm" onClick={onSelectNone} disabled={disabled || selected.size === 0}>
            清空选择
          </Button>
          <Button variant="ghost" size="sm" onClick={onSelectSafe} disabled={disabled || !scan}>
            选中可安全清理
          </Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={disabled || loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {loading ? "正在扫描" : "重新扫描"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-cleanup-apply
            onClick={onApply}
            disabled={disabled || applyDisabled}
            title={applyDisabledReason}
          >
            <Trash2 className="size-4" />
            {applyCount > 0 ? `清理选中 · ${formatBytes(applyBytes)}` : "清理选中"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            重试
          </Button>
        </div>
      ) : null}

      {loading && !scan ? (
        <div className="cleanup-empty" role="status" aria-live="polite">
          <Loader2 className="size-5 animate-spin" />
          <span>正在读取缓存与更新包大小，首次扫描通常需要几十秒…</span>
        </div>
      ) : null}

      {scan ? (
        <>
          <dl className="cleanup-summary">
            <div>
              <dt>可回收</dt>
              <dd>{formatBytes(summary.reclaimableBytes)}</dd>
              <span>{summary.availableCount} 个位置有内容</span>
            </div>
            <div>
              <dt>已选中</dt>
              <dd>{formatBytes(summary.selectedBytes)}</dd>
              <span>{selected.size} 项待清理</span>
            </div>
            <div>
              <dt>只读盘点</dt>
              <dd>{formatBytes(scan.inventoryBytes)}</dd>
              <span>不会删除</span>
            </div>
            <div>
              <dt>需管理员</dt>
              <dd>{summary.blocked}</dd>
              <span>{scan.isAdmin ? "当前已具备权限" : "当前为普通权限"}</span>
            </div>
          </dl>

          {!scan.isAdmin ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300" role="status">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                当前以普通权限运行，系统级位置无法读取或清理。以管理员身份运行可多处理 {summary.blocked} 个位置。
              </span>
            </div>
          ) : null}

          {groups.map(({ meta, targets }) => {
            const groupBytes = targets
              .filter((target) => target.kind !== "report")
              .reduce((sum, target) => sum + target.bytes, 0);
            return (
              <div className="cleanup-group" key={meta.id}>
                <div className="cleanup-group-head">
                  <h3>{meta.label}</h3>
                  <span className="cleanup-group-meta">
                    {meta.description}
                    {groupBytes > 0 ? ` · ${formatBytes(groupBytes)}` : ""}
                  </span>
                </div>
                <div className="optimizer-item-list">
                  {targets.map((target) => {
                    const risk = getRiskMeta(target.risk);
                    const selectable = isSelectable(target);
                    const checked = selected.has(target.id);
                    return (
                      <label
                        key={target.id}
                        className={`cleanup-row${!target.available ? " is-unavailable" : ""}`}
                        data-selectable={selectable || undefined}
                      >
                        <input
                          type="checkbox"
                          className="cleanup-checkbox"
                          checked={checked}
                          disabled={disabled || !selectable}
                          onChange={(event) => onToggle(target.id, event.target.checked)}
                          aria-label={`${checked ? "取消选择" : "选择清理"} ${target.label}`}
                        />
                        <div className="cleanup-row-body">
                          <div className="cleanup-row-title">
                            <span>{target.label}</span>
                            <Badge variant={risk.variant}>{risk.label}</Badge>
                            {!target.available ? (
                              <Badge variant="outline">{target.skippedReason || "不可用"}</Badge>
                            ) : null}
                          </div>
                          <p>{target.description}</p>
                          {target.note ? <p className="cleanup-note">{target.note}</p> : null}
                          {target.paths.length > 0 ? (
                            <p className="cleanup-paths" title={target.paths.join("\n")}>
                              {target.paths.slice(0, 2).join("  ·  ")}
                              {target.paths.length > 2 ? `  ·  等 ${target.paths.length} 处` : ""}
                            </p>
                          ) : null}
                          {target.entries.length > 0 ? (
                            <ul className="cleanup-entries">
                              {target.entries.slice(0, 5).map((entry) => (
                                <li key={`${entry.Name}-${entry.Date}`}>
                                  <span className="truncate">{entry.Name}</span>
                                  <span className="cleanup-entry-size">
                                    {formatBytes(entry.Bytes)} · {entry.Date}
                                  </span>
                                </li>
                              ))}
                              {target.entries.length > 5 ? (
                                <li className="cleanup-entry-more">另有 {target.entries.length - 5} 个文件未列出</li>
                              ) : null}
                            </ul>
                          ) : null}
                        </div>
                        <div className="cleanup-row-size">
                          <span>{formatBytes(target.bytes)}</span>
                          <span className="cleanup-files">{formatCount(target.files)} 个文件</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <p className="cleanup-footnote">
            扫描阈值：清理一天前未修改的临时文件。删除操作只移除声明位置下的内容，保留目录本身；符号链接与重解析点会被跳过。
            扫描时间 {new Date(scan.scannedAt).toLocaleString("zh-CN")}
            {scan.logFile ? ` · 日志 ${scan.logFile}` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
