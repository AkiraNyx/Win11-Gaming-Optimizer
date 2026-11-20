"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { CleanupScan } from "@/types/cleanup";

/**
 * Loads the cleanup inventory. The PowerShell scan walks large cache trees, so
 * it is triggered lazily: only when the cleanup view is first opened, and then
 * on explicit refreshes.
 */
export function useCleanupScan(enabled: boolean) {
  const [scan, setScan] = useState<CleanupScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (): Promise<CleanupScan | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/cleanup/scan");
      if (response.status === 401) throw new Error("会话已过期，请从启动器重新打开页面。");
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "清理扫描失败");
      }
      const data = await response.json() as CleanupScan;
      if (!Array.isArray(data?.targets)) throw new Error("清理扫描返回了无法识别的结果");
      if (requestId !== requestIdRef.current) return null;
      setScan(data);
      return data;
    } catch (requestError) {
      if (requestId === requestIdRef.current) {
        setError(requestError instanceof Error ? requestError.message : "清理扫描失败");
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled && scan === null && !inFlight.current) void refresh();
  }, [enabled, scan, refresh]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  return { scan, loading, error, refresh };
}
