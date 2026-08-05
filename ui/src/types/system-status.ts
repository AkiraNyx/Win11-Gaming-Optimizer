import type { TargetValue } from "./optimization";

export type ItemStatusKind = "boolean" | "enum" | "numeric" | "command" | "diagnostic";

export interface ItemStatus {
  kind: ItemStatusKind;
  currentValue: TargetValue | null;
  available: boolean;
  applicable?: boolean;
  stateConsistent?: boolean;
  description: string;
  blockedReason?: string;
  blockedTargets?: TargetValue[];
}

export type SystemStatus = Record<string, Record<string, ItemStatus>>;
