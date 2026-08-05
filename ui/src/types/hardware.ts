export interface HardwareInfo {
  hasSSD: boolean;
  hasHDD: boolean;
  ramGB: number;
  cpuCores: number;
  cpuName: string;
  gpuName: string;
  gpuBrand: "NVIDIA" | "AMD" | "Intel" | "Unknown";
}
