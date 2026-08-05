"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import type { HardwareInfo } from "@/types/hardware";

const unknownHardware: HardwareInfo = {
  hasSSD: false,
  hasHDD: false,
  ramGB: 0,
  cpuCores: 0,
  cpuName: "未知 CPU",
  gpuName: "未知 GPU",
  gpuBrand: "Unknown",
};

function clientDetect(): HardwareInfo {
  const ramGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cpuCores = navigator.hardwareConcurrency;
  return {
    hasSSD: false, hasHDD: false,
    ramGB: ramGB ? Math.round(ramGB) : 0,
    cpuCores: cpuCores || 0,
    cpuName: cpuCores ? `${cpuCores} 核心 CPU` : "未知 CPU",
    gpuName: "未知 GPU",
    gpuBrand: "Unknown",
  };
}

export function useHardwareDetect(): HardwareInfo {
  const [hw, setHw] = useState<HardwareInfo>(unknownHardware);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/hardware")
      .then((r) => { if (!r.ok) throw new Error("API unavailable"); return r.json(); })
      .then((data: HardwareInfo) => { if (!cancelled) setHw(data); })
      .catch(() => { if (!cancelled) setHw(clientDetect()); });
    return () => { cancelled = true; };
  }, []);
  return hw;
}
