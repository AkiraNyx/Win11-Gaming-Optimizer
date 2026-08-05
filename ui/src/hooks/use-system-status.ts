"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import type { ItemStatus, SystemStatus } from "@/types/system-status";

export type { ItemStatus, SystemStatus } from "@/types/system-status";

const emptyStatus: SystemStatus = {};

interface UseSystemStatusResult {
  status: SystemStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<SystemStatus | null>;
}

export function useSystemStatus(): UseSystemStatusResult {
  const [status, setStatus] = useState<SystemStatus>(emptyStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async (): Promise<SystemStatus | null> => {
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const response = await apiFetch("/api/status/all", { signal: controller.signal });
      if (!response.ok) throw new Error("API unavailable");
      const data = await response.json() as SystemStatus;
      if (requestId !== requestIdRef.current) return null;
      setError(null);
      setStatus(data);
      return data;
    } catch (requestError: unknown) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return null;
      setStatus(emptyStatus);
      setError(requestError instanceof Error ? requestError.message : "API unavailable");
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    return () => controllerRef.current?.abort();
  }, [fetchStatus]);

  return { status, loading, error, refresh: fetchStatus };
}

export function getItemSystemStatus(
  status: SystemStatus,
  categoryId: string,
  itemId: string,
): ItemStatus | null {
  return status[categoryId]?.[itemId] ?? null;
}
