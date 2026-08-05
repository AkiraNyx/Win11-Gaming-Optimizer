'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Play, RefreshCw, X } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClientOnly } from "@/components/client-only";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { CategoryPanel } from "@/components/optimization/category-panel";
import { ChangeSummary } from "@/components/optimization/change-summary";
import { ExportDialog } from "@/components/optimization/export-dialog";
import { ImportDialog } from "@/components/optimization/import-dialog";
import { OptimizeDialog } from "@/components/optimization/optimize-dialog";
import { PresetSelector } from "@/components/optimization/preset-selector";
import { RestoreDialog } from "@/components/optimization/restore-dialog";
import { RuntimeLogDialog } from "@/components/optimization/runtime-log-dialog";
import { UninstallDialog } from "@/components/optimization/uninstall-dialog";
import { useHardwareDetect } from "@/hooks/use-hardware-detect";
import { useOptimizationConfig } from "@/hooks/use-optimization-config";
import { useSystemStatus } from "@/hooks/use-system-status";
import { apiFetch } from "@/lib/api";
import { categories } from "@/lib/categories";
import { countCategoryChanges, countChanges, exportToJSON, generatePresetConfig } from "@/lib/presets";
import type { ConfigPresetLevel, PresetLevel } from "@/types/optimization";
import type { RestoreAvailabilityState, RuntimeCapabilities, RuntimeInitializationState } from "@/types/runtime";

const PRESET_LABELS: Record<Exclude<ConfigPresetLevel, "custom">, string> = {
  conservative: "保守",
  balanced: "平衡",
  extreme: "极致",
};

function canReceiveFocus(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target.getAttribute("aria-disabled") === "true") return false;
  return !(target instanceof HTMLButtonElement) || !target.disabled;
}

export default function Home() {
  const { status: systemStatus, loading: statusLoading, error: statusError, refresh: refreshStatus } = useSystemStatus();
  const {
    config,
    activePreset,
    updateTarget,
    updateCommand,
    syncCategoryToCurrent,
    applyPreset,
    importConfig,
    resetExecutedCommands,
    discardStoredConfig,
    changes,
    configError,
    categorySyncError,
    clearCategorySyncError,
    configurationLocked,
    configurationReady,
  } = useOptimizationConfig(systemStatus);
  const hardware = useHardwareDetect();
  const [activeCategory, setActiveCategory] = useState(categories[0].id);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [runtimeLogOpen, setRuntimeLogOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [discardConfigOpen, setDiscardConfigOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<Exclude<ConfigPresetLevel, "custom"> | null>(null);
  const [statusRequestSource, setStatusRequestSource] = useState<"current" | string | null>(null);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [restoreAvailability, setRestoreAvailability] = useState<RestoreAvailabilityState>("loading");
  const presetTriggerRef = useRef<HTMLElement | null>(null);
  const discardTriggerRef = useRef<HTMLElement | null>(null);
  const exportTriggerRef = useRef<HTMLElement | null>(null);
  const importTriggerRef = useRef<HTMLElement | null>(null);
  const optimizeTriggerRef = useRef<HTMLElement | null>(null);
  const restoreTriggerRef = useRef<HTMLElement | null>(null);
  const runtimeLogTriggerRef = useRef<HTMLElement | null>(null);
  const uninstallTriggerRef = useRef<HTMLElement | null>(null);
  const currentPresetRef = useRef<HTMLButtonElement | null>(null);
  const statusRequestInFlightRef = useRef(false);
  const runtimeRequestIdRef = useRef(0);
  const runtimePollIdRef = useRef(0);
  const restoreRequestIdRef = useRef(0);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const refreshRuntimeCapabilities = useCallback(async (): Promise<RuntimeInitializationState | "request-error"> => {
    const requestId = ++runtimeRequestIdRef.current;
    setRuntimeLoading(true);
    setRuntimeError(false);
    try {
      const response = await apiFetch("/api/runtime");
      if (!response.ok) throw new Error("Runtime API unavailable");
      const capabilities = await response.json() as RuntimeCapabilities;
      if (!(["initializing", "ready", "error"] as const).includes(capabilities.state)) throw new Error("Invalid runtime response");
      if (requestId !== runtimeRequestIdRef.current) return "request-error";
      setRuntimeCapabilities(capabilities);
      setRuntimeLoading(capabilities.state === "initializing");
      setRuntimeError(capabilities.state === "error");
      return capabilities.state;
    } catch {
      if (requestId !== runtimeRequestIdRef.current) return "request-error";
      setRuntimeCapabilities(null);
      setRuntimeError(true);
      setRuntimeLoading(false);
      return "request-error";
    }
  }, []);
  const pollRuntimeCapabilities = useCallback(async () => {
    const pollId = ++runtimePollIdRef.current;
    let state = await refreshRuntimeCapabilities();
    while (state === "initializing" && pollId === runtimePollIdRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      state = await refreshRuntimeCapabilities();
    }
    return state === "ready";
  }, [refreshRuntimeCapabilities]);
  const refreshRestoreAvailability = useCallback(async (): Promise<RestoreAvailabilityState> => {
    const requestId = ++restoreRequestIdRef.current;
    setRestoreAvailability("loading");
    try {
      const response = await apiFetch("/api/restore/availability");
      if (!response.ok) throw new Error("Restore availability API unavailable");
      const data = await response.json() as { available?: boolean };
      if (typeof data.available !== "boolean") throw new Error("Invalid restore availability response");
      const nextState = data.available ? "available" : "empty";
      if (requestId === restoreRequestIdRef.current) setRestoreAvailability(nextState);
      return nextState;
    } catch {
      if (requestId === restoreRequestIdRef.current) setRestoreAvailability("error");
      return "error";
    }
  }, []);
  const interactionBusy = statusLoading || statusRequestSource !== null;
  const mutationsDisabled = runtimeLoading || runtimeError || runtimeCapabilities?.mutationsEnabled !== true;
  const mutationDisabledMessage = runtimeLoading
    ? "正在初始化受保护运行环境，系统修改暂不可用。"
    : runtimeError
    ? "无法确认服务运行权限，系统修改操作已停用。"
    : runtimeCapabilities && !runtimeCapabilities.supportedWindows11
      ? "当前系统不是受支持的 Windows 11 客户端版本（非 Windows Server），系统修改操作已停用。"
      : runtimeCapabilities?.error || "当前服务没有安全执行系统修改所需的管理员权限或受保护运行目录。";
  const restoreDisabledReason = interactionBusy
    ? "正在读取系统状态，请稍候。"
    : mutationsDisabled
      ? mutationDisabledMessage
      : restoreAvailability === "loading"
        ? "正在检查可撤销的优化记录。"
        : restoreAvailability === "empty"
          ? "尚无可撤销的优化记录。"
          : restoreAvailability === "error"
            ? "无法检查可撤销的优化记录，请稍后重试。"
            : undefined;

  useEffect(() => {
    void pollRuntimeCapabilities();
    return () => {
      runtimeRequestIdRef.current += 1;
      runtimePollIdRef.current += 1;
      restoreRequestIdRef.current += 1;
    };
  }, [pollRuntimeCapabilities]);

  useEffect(() => {
    if (runtimeCapabilities?.state === "ready") void refreshRestoreAvailability();
  }, [refreshRestoreAvailability, runtimeCapabilities?.state]);

  const jsonContent = useMemo(() => exportToJSON(config, hardware), [config, hardware]);
  const categoryChangeCounts = useMemo(() => countCategoryChanges(config, systemStatus), [config, systemStatus]);
  const currentCategory = categories.find((c) => c.id === activeCategory);

  const refreshForAction = async (source: "current" | string) => {
    if (statusRequestInFlightRef.current || statusLoading) return null;
    statusRequestInFlightRef.current = true;
    setStatusRequestSource(source);
    try {
      return await refreshStatus();
    } finally {
      statusRequestInFlightRef.current = false;
      setStatusRequestSource(null);
    }
  };

  const requestPreset = async (preset: PresetLevel) => {
    if (preset === "custom") return;
    if (preset === "current") {
      const freshStatus = await refreshForAction("current");
      if (freshStatus) applyPreset("current", freshStatus);
      return;
    }
    presetTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingPreset(preset);
  };

  const rememberTrigger = (triggerRef: { current: HTMLElement | null }) => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const returnFocus = (triggerRef: { current: HTMLElement | null }) => {
    const target = triggerRef.current?.isConnected ? triggerRef.current : currentPresetRef.current;
    if (interactionBusy) {
      pendingFocusRef.current = target;
      return;
    }
    const focusTarget = canReceiveFocus(target) ? target : currentPresetRef.current;
    if (canReceiveFocus(focusTarget)) focusTarget.focus();
  };

  const openImport = () => {
    rememberTrigger(importTriggerRef);
    setImportOpen(true);
  };

  const pendingPresetSummary = pendingPreset
    ? countChanges(generatePresetConfig(pendingPreset), systemStatus)
    : null;
  const handleOptimizationComplete = useCallback(async () => {
    resetExecutedCommands();
    const [status] = await Promise.all([refreshStatus(), refreshRestoreAvailability()]);
    return status !== null;
  }, [refreshRestoreAvailability, refreshStatus, resetExecutedCommands]);
  const handleStatusRefreshComplete = useCallback(async () => {
    const [status] = await Promise.all([refreshStatus(), refreshRestoreAvailability()]);
    return status !== null;
  }, [refreshRestoreAvailability, refreshStatus]);
  useEffect(() => {
    if (interactionBusy || !pendingFocusRef.current) return;
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const focusTarget = canReceiveFocus(target) ? target : currentPresetRef.current;
    if (canReceiveFocus(focusTarget)) focusTarget.focus();
  }, [interactionBusy]);
  const handleCategorySync = async (categoryId: string) => {
    const freshStatus = await refreshForAction(categoryId);
    if (freshStatus) syncCategoryToCurrent(categoryId, freshStatus);
  };

  return (
    <ClientOnly>
      <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col overflow-hidden">
        <Header
          onExport={() => { rememberTrigger(exportTriggerRef); setExportOpen(true); }}
          onImport={openImport}
          onReset={() => { void requestPreset("balanced"); }}
          onRestore={() => {
            rememberTrigger(restoreTriggerRef);
            void refreshRestoreAvailability();
            setRestoreOpen(true);
          }}
          onUninstall={() => { rememberTrigger(uninstallTriggerRef); setUninstallOpen(true); }}
          configActionsDisabled={!configurationReady}
          disabled={interactionBusy}
          disabledReason="正在读取系统状态，请稍候。"
          mutationDisabled={mutationsDisabled}
          mutationDisabledReason={mutationDisabledMessage}
          uninstallDisabled={restoreAvailability !== "available"}
          uninstallDisabledReason={restoreDisabledReason}
        />
        <div className="flex flex-col items-stretch justify-between gap-3 border-b border-border px-4 py-2.5 lg:flex-row lg:items-center lg:gap-4 lg:px-6">
          <PresetSelector
            activePreset={activePreset}
            onSelect={(preset) => { void requestPreset(preset); }}
            loading={statusLoading && (statusRequestSource === "current" || statusRequestSource === null)}
            currentDisabled={interactionBusy}
            disabled={configurationLocked || interactionBusy}
            currentButtonRef={currentPresetRef}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <ChangeSummary changed={changes.changed} enabled={changes.enabled} disabled={changes.disabled} highRisk={changes.highRisk} unavailable={changes.unavailable} blocked={changes.blocked} />
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => { rememberTrigger(optimizeTriggerRef); setOptimizeOpen(true); }}
                disabled={mutationsDisabled || interactionBusy || !configurationReady || changes.changed === 0 || changes.unavailable > 0 || changes.blocked > 0}
                title={mutationsDisabled ? "当前服务无法执行系统修改" : !configurationReady ? "请先读取当前系统状态" : changes.blocked > 0 ? "部分目标当前不可执行，请先调整" : changes.unavailable > 0 ? "请先重新读取未知状态" : undefined}
              >
                <Play className="size-4" />执行优化
              </Button>
            </motion.div>
          </div>
        </div>
        {interactionBusy ? (
          <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs text-foreground lg:px-6" role="status" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" />正在读取系统状态，请稍候…
          </div>
        ) : null}
        {configError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive lg:px-6" role={configurationLocked ? "alert" : "status"}>
            <span>{configError}</span>
            {configurationLocked ? (
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openImport} disabled={interactionBusy}>导入有效配置</Button>
                <Button variant="destructive" size="sm" disabled={interactionBusy} onClick={() => {
                  discardTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setDiscardConfigOpen(true);
                }}>放弃原配置</Button>
              </span>
            ) : null}
          </div>
        ) : null}
        {categorySyncError ? (
          <div className="flex items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive lg:px-6" role="alert">
            <span>{categorySyncError.message}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => clearCategorySyncError(categorySyncError.categoryId)}
              aria-label="关闭分类同步错误"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : null}
        {statusError ? (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive lg:px-6" role="alert">
            系统状态读取失败，请选择“当前”重试。
          </div>
        ) : null}
        {(runtimeError || (runtimeCapabilities && !runtimeCapabilities.mutationsEnabled)) ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300 lg:px-6" role={runtimeError ? "alert" : "status"}>
            <span>{mutationDisabledMessage}</span>
            {runtimeError ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void pollRuntimeCapabilities(); }}
                disabled={runtimeLoading}
              >
                <RefreshCw className={runtimeLoading ? "size-3.5 animate-spin" : "size-3.5"} />
                {runtimeLoading ? "正在重试" : "重新检查"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {(!statusLoading || !!statusError) && changes.unavailable > 0 ? (
          <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300 lg:px-6" role="status">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>部分项目状态未知，已保留原目标并暂停执行（{changes.unavailable} 项）。重新读取成功前，此提示会持续显示。</span>
          </div>
        ) : null}
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <Sidebar
            activeCategory={activeCategory}
            onSelect={setActiveCategory}
            onShowLog={() => { rememberTrigger(runtimeLogTriggerRef); setRuntimeLogOpen(true); }}
            changeCounts={categoryChangeCounts}
            hardware={hardware}
            logOpen={runtimeLogOpen}
            disabled={interactionBusy}
          />
          <main className="flex-1 overflow-hidden" aria-busy={interactionBusy}>
            <div className="h-full overflow-y-auto thin-scroll">
              <motion.div key={activeCategory} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }} className="p-4 md:p-6">
                {currentCategory && (
                  <CategoryPanel
                    category={currentCategory}
                    config={config}
                    onTargetChange={updateTarget}
                    onCommandChange={updateCommand}
                    onSyncCurrent={(categoryId) => { void handleCategorySync(categoryId); }}
                    systemStatus={systemStatus}
                    disabled={!configurationReady || interactionBusy}
                    syncing={statusLoading && statusRequestSource === currentCategory.id}
                  />
                )}
              </motion.div>
            </div>
          </main>
        </div>
        <Footer runtime={runtimeCapabilities} loading={runtimeLoading} />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} jsonContent={jsonContent} onReturnFocus={() => returnFocus(exportTriggerRef)} />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={importConfig} onReturnFocus={() => returnFocus(importTriggerRef)} />
        <OptimizeDialog open={optimizeOpen} onOpenChange={setOptimizeOpen} config={config} preset={activePreset} hardware={hardware} onComplete={handleOptimizationComplete} onReturnFocus={() => returnFocus(optimizeTriggerRef)} />
        <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} availability={restoreAvailability} onRefreshAvailability={refreshRestoreAvailability} onComplete={handleStatusRefreshComplete} onReturnFocus={() => returnFocus(restoreTriggerRef)} />
        <RuntimeLogDialog open={runtimeLogOpen} onOpenChange={setRuntimeLogOpen} onReturnFocus={() => returnFocus(runtimeLogTriggerRef)} />
        <UninstallDialog open={uninstallOpen} onOpenChange={setUninstallOpen} availability={restoreAvailability} disabledReason={restoreDisabledReason} onRefreshAvailability={refreshRestoreAvailability} onComplete={handleStatusRefreshComplete} onReturnFocus={() => returnFocus(uninstallTriggerRef)} />
        <Dialog open={pendingPreset !== null} onOpenChange={(open) => { if (!open) setPendingPreset(null); }}>
          <DialogContent
            className="sm:max-w-md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              presetTriggerRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{pendingPreset ? `应用“${PRESET_LABELS[pendingPreset]}”预设？` : "应用预设？"}</DialogTitle>
              <DialogDescription>将按当前已读取的系统状态计算真实差异，不会立即修改系统。</DialogDescription>
            </DialogHeader>
            {pendingPresetSummary ? (
              <dl className="grid grid-cols-2 gap-3 border-y border-border py-4 text-sm">
                <div><dt className="text-muted-foreground">待调整</dt><dd className="mt-1 font-mono text-lg font-semibold">{pendingPresetSummary.changed}</dd></div>
                <div><dt className="text-muted-foreground">高风险</dt><dd className="mt-1 font-mono text-lg font-semibold text-destructive">{pendingPresetSummary.highRisk}</dd></div>
                <div><dt className="text-muted-foreground">状态未知</dt><dd className="mt-1 font-mono text-lg font-semibold">{pendingPresetSummary.unavailable}</dd></div>
                <div><dt className="text-muted-foreground">调整受限</dt><dd className="mt-1 font-mono text-lg font-semibold">{pendingPresetSummary.blocked}</dd></div>
              </dl>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingPreset(null)}>取消</Button>
              <Button onClick={() => {
                if (pendingPreset) applyPreset(pendingPreset);
                setPendingPreset(null);
              }}>应用预设</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={discardConfigOpen} onOpenChange={setDiscardConfigOpen}>
          <DialogContent
            className="sm:max-w-md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const returnTarget = discardTriggerRef.current?.isConnected
                ? discardTriggerRef.current
                : currentPresetRef.current;
              returnTarget?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>放弃原配置？</DialogTitle>
              <DialogDescription>已保留的本地配置将被清除。系统状态读取成功后，软件会重新建立“当前”配置。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiscardConfigOpen(false)}>取消</Button>
              <Button variant="destructive" onClick={() => {
                discardStoredConfig();
                setDiscardConfigOpen(false);
              }}>清除并重新读取</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </MotionConfig>
    </ClientOnly>
  );
}
