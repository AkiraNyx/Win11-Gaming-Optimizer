"use client";

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CircleHelp, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";

interface ChangeSummaryProps {
  changed: number;
  enabled: number;
  disabled: number;
  highRisk: number;
  unavailable: number;
  blocked: number;
}

export function ChangeSummary({ changed, enabled, disabled, highRisk, unavailable, blocked }: ChangeSummaryProps) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="待执行变更摘要">
      <span className="text-muted-foreground">待调整</span>
      <motion.span key={changed} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className="font-mono text-sm font-semibold">{changed}</motion.span>
      {enabled > 0 ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowUpFromLine className="size-3.5" />{enabled} 启用</span> : null}
      {disabled > 0 ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><ArrowDownToLine className="size-3.5" />{disabled} 关闭</span> : null}
      {highRisk > 0 ? <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" />{highRisk} 高风险</span> : null}
      {unavailable > 0 ? <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleHelp className="size-3.5" />{unavailable} 未知</span> : null}
      {blocked > 0 ? <span className="inline-flex items-center gap-1 text-destructive"><ShieldAlert className="size-3.5" />{blocked} 受限</span> : null}
    </div>
  );
}
