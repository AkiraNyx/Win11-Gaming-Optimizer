export type CleanupRisk = "safe" | "medium" | "caution" | "report";
export type CleanupKind = "contents" | "files" | "recyclebin" | "report";

export interface CleanupEntry {
  Name: string;
  Bytes: number;
  Date: string;
}

export interface CleanupTarget {
  id: string;
  group: string;
  label: string;
  description: string;
  risk: CleanupRisk;
  kind: CleanupKind;
  requiresAdmin: boolean;
  defaultSelected: boolean;
  available: boolean;
  skippedReason: string;
  bytes: number;
  files: number;
  paths: string[];
  entries: CleanupEntry[];
  warnings: string[];
  note: string;
}

export interface CleanupScan {
  mode: "scan";
  scannedAt: string;
  isAdmin: boolean;
  olderThanDays: number;
  /** Identifies the previewed file list that apply is allowed to delete. */
  planId: string;
  totalBytes: number;
  totalFiles: number;
  inventoryBytes: number;
  targets: CleanupTarget[];
  logFile?: string;
}

export type CleanupApplyStatus = "ok" | "partial" | "failed" | "skipped" | "stale";

export interface CleanupApplyItem {
  id: string;
  status: CleanupApplyStatus;
  reason: string;
  freedBytes: number;
  removedFiles: number;
  failed: string[];
}

export interface CleanupApply {
  mode: "apply";
  finishedAt: string;
  isAdmin: boolean;
  olderThanDays: number;
  planId: string;
  freedBytes: number;
  removedFiles: number;
  failureCount: number;
  results: CleanupApplyItem[];
}

export interface CleanupApplyRequest {
  targets: string[];
  olderThanDays: number;
  planId: string;
  operationId?: string;
}
