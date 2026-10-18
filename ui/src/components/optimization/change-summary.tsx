"use client";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CircleHelp, ShieldAlert } from "lucide-react";

interface ChangeSummaryProps { changed: number; enabled: number; disabled: number; highRisk: number; unavailable: number; blocked: number; }
export function ChangeSummary({ changed, enabled, disabled, highRisk, unavailable, blocked }: ChangeSummaryProps) {
  return <div className="optimizer-summary" aria-label="待执行变更摘要" aria-live="polite">
    <span className="optimizer-summary-total">{changed}</span><span>项待调整</span>
    {(enabled > 0 || disabled > 0 || highRisk > 0 || unavailable > 0 || blocked > 0) && <span className="optimizer-summary-divider" aria-hidden="true" />}
    {enabled > 0 && <span className="inline-flex items-center gap-1 text-[var(--ax-color-success)]"><ArrowUpFromLine className="size-3.5" />{enabled} 启用</span>}
    {disabled > 0 && <span className="inline-flex items-center gap-1 text-[var(--ax-color-warning)]"><ArrowDownToLine className="size-3.5" />{disabled} 关闭</span>}
    {highRisk > 0 && <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" />{highRisk} 高风险</span>}
    {unavailable > 0 && <span className="inline-flex items-center gap-1"><CircleHelp className="size-3.5" />{unavailable} 未知</span>}
    {blocked > 0 && <span className="inline-flex items-center gap-1 text-destructive"><ShieldAlert className="size-3.5" />{blocked} 受限</span>}
  </div>;
}
