import { useState, useCallback } from "react";
import type { PresetConfig, PresetLevel, PreOptimizeSnapshot, SnapshotMeta } from "@/types/optimization";
import type { HardwareInfo } from "@/types/hardware";
import { apiFetch } from "@/lib/api";
import { compactHardwareInfo } from "@/lib/presets";

interface UseSnapshotHistory {
  saveSnapshot: (config: PresetConfig, preset: PresetLevel, hardware?: HardwareInfo) => Promise<boolean>;
  deleteSnapshot: (timestamp: string) => Promise<boolean>;
  listSnapshots: () => Promise<SnapshotMeta[]>;
  saving: boolean;
}

export function useSnapshotHistory(): UseSnapshotHistory {
  const [saving, setSaving] = useState(false);

  const saveSnapshot = useCallback(async (
    config: PresetConfig,
    preset: PresetLevel,
    hardware?: HardwareInfo,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const snapshot: PreOptimizeSnapshot = {
        timestamp: new Date().toISOString(),
        preset,
        hardware: compactHardwareInfo(hardware),
        config,
      };
      const res = await apiFetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.success === true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const listSnapshots = useCallback(async (): Promise<SnapshotMeta[]> => {
    try {
      const res = await apiFetch("/api/snapshots");
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }, []);

  const deleteSnapshot = useCallback(async (timestamp: string): Promise<boolean> => {
    try {
      const res = await apiFetch("/api/snapshots/" + encodeURIComponent(timestamp), {
        method: "DELETE",
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { saveSnapshot, listSnapshots, deleteSnapshot, saving };
}
