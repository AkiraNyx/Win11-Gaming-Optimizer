import type {
  OptimizationCategory,
  OptimizationOption,
  TargetValue,
  TransitionWarning,
} from "@/types/optimization";

const booleanOptions = [
  { value: false, label: "关闭" },
  { value: true, label: "开启" },
] as const satisfies readonly OptimizationOption[];

const serviceOptions = [
  { value: "automaticDelayed", label: "自动（延迟启动）" },
  { value: "automatic", label: "自动" },
  { value: "manual", label: "手动" },
  { value: "disabled", label: "禁用" },
] as const satisfies readonly OptimizationOption[];

const qualityDelayOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "不延迟" },
  { value: 7, label: "延迟 7 天" },
] as const satisfies readonly OptimizationOption[];

const featureDelayOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "不延迟" },
  { value: 30, label: "延迟 30 天" },
] as const satisfies readonly OptimizationOption[];

const bootTimeoutOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "0 秒" },
  { value: 30, label: "30 秒" },
] as const satisfies readonly OptimizationOption[];

const foregroundPriorityOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 2, label: "均衡调度" },
  { value: 38, label: "前台优先" },
] as const satisfies readonly OptimizationOption[];

const backgroundAppOptions = [
  { value: "userControl", label: "由用户控制" },
  { value: "forceAllow", label: "始终允许" },
  { value: "forceDeny", label: "禁止后台运行" },
] as const satisfies readonly OptimizationOption[];

const powerPlanOptions = [
  { value: "balanced", label: "平衡" },
  { value: "ultimatePerformance", label: "卓越性能" },
] as const satisfies readonly OptimizationOption[];

const minimumProcessorOptions = [
  { value: 5, label: "5%" },
  { value: 100, label: "100%" },
] as const satisfies readonly OptimizationOption[];

const boostModeOptions = [
  { value: 0, label: "关闭" },
  { value: 1, label: "启用" },
  { value: 2, label: "极速" },
  { value: 3, label: "高效启用" },
  { value: 4, label: "高效极速" },
] as const satisfies readonly OptimizationOption[];

const pcieLpmOptions = [
  { value: 0, label: "关闭" },
  { value: 1, label: "中等节能" },
  { value: 2, label: "最大节能" },
] as const satisfies readonly OptimizationOption[];

const diskTimeoutOptions = [
  { value: 0, label: "从不" },
  { value: 900, label: "15 分钟" },
  { value: 1800, label: "30 分钟" },
] as const satisfies readonly OptimizationOption[];

const fsutilBehaviorOptions = [0, 1, 2, 3].map((value) => ({
  value,
  label: `${value}`,
})) satisfies readonly OptimizationOption[];

const pagefileOptions = [
  { value: "systemManaged", label: "系统管理" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
  { value: "disabled", label: "关闭" },
] as const satisfies readonly OptimizationOption[];

const prefetchOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const crashDumpOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "关闭" },
  { value: 1, label: "完整内存转储" },
  { value: 2, label: "内核内存转储" },
  { value: 3, label: "小内存转储" },
  { value: 7, label: "自动内存转储" },
] as const satisfies readonly OptimizationOption[];

const cacheModeOptions = [
  { value: "desktop", label: "桌面应用优先" },
  { value: "server", label: "大型系统缓存" },
] as const satisfies readonly OptimizationOption[];

const timerModeOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: "platformTick", label: "固定平台计时" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const coreParkingOptions = [
  { value: 10, label: "10% 保持唤醒" },
  { value: 100, label: "全部保持唤醒" },
] as const satisfies readonly OptimizationOption[];

const hardwareSchedulingOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const gpuPriorityOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 8, label: "高优先级" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const dnsOptions = [
  { value: "automatic", label: "自动获取" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const nicPowerOptions = [
  { value: "enabled", label: "启用节能" },
  { value: "disabled", label: "禁用节能" },
  { value: "mixed", label: "混合状态（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const bandwidthOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "不预留" },
] as const satisfies readonly OptimizationOption[];

const visualEffectsOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: "appearance", label: "最佳外观" },
  { value: "performance", label: "最佳性能" },
  { value: "custom", label: "自定义（仅保留当前）", preserveOnly: true },
] as const satisfies readonly OptimizationOption[];

const telemetryOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: 0, label: "安全数据" },
  { value: 1, label: "必需诊断数据" },
  { value: 2, label: "增强诊断数据" },
  { value: 3, label: "可选诊断数据" },
] as const satisfies readonly OptimizationOption[];

const depOptions = [
  { value: "systemDefault", label: "系统默认" },
  { value: "OptIn", label: "仅系统程序" },
  { value: "OptOut", label: "除排除项外的所有程序" },
  { value: "AlwaysOn", label: "始终开启" },
  { value: "AlwaysOff", label: "始终关闭" },
] as const satisfies readonly OptimizationOption[];

const mitigationOptions = [
  { value: "systemDefault", label: "系统默认防护" },
  { value: "reduced", label: "降低防护" },
] as const satisfies readonly OptimizationOption[];

function transition(
  to: TargetValue,
  message: string,
  severity: TransitionWarning["severity"],
  from: TargetValue | "*" = "*",
): readonly TransitionWarning[] {
  return [{ from, to, message, severity }];
}

export const categories: OptimizationCategory[] = [
  {
    id: "windowsUpdate",
    name: "Windows 更新",
    icon: "Download",
    description: "更新策略、延迟更新、P2P 分发",
    items: [
      { id: "disableP2P", name: "P2P 更新分发", description: "控制 Windows 是否通过局域网分享更新文件", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "deferQualityUpdates", name: "质量更新延迟", description: "设置质量更新的延迟安装天数", safetyLevel: "balanced", control: "select", options: qualityDelayOptions, targetRange: { min: 0, max: 365 } },
      { id: "deferFeatureUpdates", name: "功能更新延迟", description: "设置功能更新的延迟安装天数", safetyLevel: "balanced", control: "select", options: featureDelayOptions, targetRange: { min: 0, max: 3650 } },
      { id: "disableAutoDriverUpdate", name: "Windows 自动驱动更新", description: "控制 Windows Update 是否自动安装设备驱动", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableAutoUpdate", name: "Windows 自动更新", description: "控制 Windows 是否自动检查并安装更新", safetyLevel: "extreme", control: "switch", options: booleanOptions, transitionWarnings: transition(false, "关闭自动更新可能导致安全补丁延迟安装。", "high") },
    ],
  },
  {
    id: "bootOptimization",
    name: "启动优化",
    icon: "Zap",
    description: "快速启动、启动项管理、引导配置",
    items: [
      { id: "fastStartup", name: "快速启动", description: "控制 Windows 快速启动功能", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableBootLog", name: "启动日志", description: "控制引导过程是否记录启动日志", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "reduceBootTimeout", name: "启动菜单超时", description: "设置多系统启动菜单的等待时间", safetyLevel: "balanced", control: "select", options: bootTimeoutOptions, targetRange: { min: 0, max: 999 } },
      { id: "disableStartupSound", name: "启动声音", description: "控制 Windows 启动音效", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "bootProcessorsFull", name: "启动处理器限制", description: "移除 BCD 中的处理器数量限制", safetyLevel: "extreme", control: "command", transitionWarnings: transition(true, "修改引导配置后，极少数设备可能出现启动不稳定问题。", "high") },
    ],
  },
  {
    id: "taskScheduling",
    name: "前后台调度",
    icon: "ArrowUpDown",
    description: "游戏模式、进程优先级、后台应用",
    items: [
      { id: "enableGameMode", name: "游戏模式", description: "控制 Windows 游戏模式", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "foregroundPriority", name: "前台程序调度", description: "设置处理器对前台程序的调度优先级", safetyLevel: "conservative", control: "select", options: foregroundPriorityOptions, targetRange: { min: 0, max: 63 } },
      { id: "disableBackgroundApps", name: "后台应用运行", description: "控制应用是否可以在后台运行", safetyLevel: "balanced", control: "select", options: backgroundAppOptions, transitionWarnings: transition("forceDeny", "禁止后台运行后，部分应用将无法在后台接收通知。", "medium") },
      { id: "disableGameDVR", name: "Game DVR 录制", description: "控制 Windows 游戏录制功能", safetyLevel: "conservative", control: "switch", options: booleanOptions },
    ],
  },
  {
    id: "serviceOptimization",
    name: "服务优化",
    icon: "Settings",
    description: "Windows 服务启动类型",
    items: [
      { id: "telemetry", name: "遥测数据采集服务", description: "DiagTrack 服务的启动类型", safetyLevel: "conservative", control: "select", options: serviceOptions },
      { id: "fax", name: "传真服务", description: "Fax 服务的启动类型", safetyLevel: "conservative", control: "select", options: serviceOptions },
      { id: "remoteRegistry", name: "远程注册表服务", description: "RemoteRegistry 服务的启动类型", safetyLevel: "conservative", control: "select", options: serviceOptions },
      { id: "errorReporting", name: "Windows 错误报告服务", description: "WerSvc 服务的启动类型", safetyLevel: "conservative", control: "select", options: serviceOptions },
      { id: "printSpooler", name: "打印服务", description: "Spooler 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions, transitionWarnings: transition("disabled", "禁用打印服务后将无法使用打印机。", "high") },
      { id: "sysMain", name: "SysMain 服务", description: "SysMain 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "windowsSearch", name: "Windows Search 服务", description: "WSearch 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "xboxAuth", name: "Xbox 认证服务", description: "XblAuthManager 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "xboxGameSave", name: "Xbox 游戏存档服务", description: "XblGameSave 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "xboxNetwork", name: "Xbox 网络服务", description: "XboxNetApiSvc 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "xboxGip", name: "Xbox 外设服务", description: "XboxGipSvc 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions },
      { id: "diagHub", name: "诊断中心服务", description: "Diagnostics Hub 服务的启动类型", safetyLevel: "conservative", control: "select", options: serviceOptions },
      { id: "bluetooth", name: "蓝牙支持服务", description: "bthserv 服务的启动类型", safetyLevel: "balanced", control: "select", options: serviceOptions, transitionWarnings: transition("disabled", "禁用蓝牙支持服务后，蓝牙设备将无法连接。", "medium") },
    ],
  },
  {
    id: "powerManagement",
    name: "电源管理",
    icon: "Battery",
    description: "电源计划、节流、PCIe/USB 电源",
    items: [
      { id: "ultimatePerformancePlan", name: "电源计划", description: "选择 Windows 电源计划", safetyLevel: "conservative", control: "select", options: powerPlanOptions, targetPattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
      { id: "minProcessorState100", name: "最小处理器状态", description: "设置交流供电时的最小处理器状态", safetyLevel: "balanced", control: "select", options: minimumProcessorOptions, targetRange: { min: 0, max: 100 }, transitionWarnings: transition(100, "将最小处理器状态设为 100% 会增加功耗和发热。", "medium") },
      { id: "disablePowerThrottling", name: "电源节流", description: "控制 Windows 电源节流", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableUsbSuspend", name: "USB 选择性暂停", description: "控制 USB 设备的选择性暂停", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disablePcieLpm", name: "PCIe 链路状态电源管理", description: "设置 PCIe 链路状态电源管理模式", safetyLevel: "balanced", control: "select", options: pcieLpmOptions },
      { id: "disableDiskAutoOff", name: "磁盘自动关闭", description: "设置磁盘空闲后自动关闭的等待时间", safetyLevel: "conservative", control: "select", options: diskTimeoutOptions, targetRange: { min: 0, max: 86400 } },
      { id: "aggressiveBoost", name: "处理器性能提升模式", description: "设置处理器 Boost 策略", safetyLevel: "balanced", control: "select", options: boostModeOptions },
    ],
  },
  {
    id: "storageOptimization",
    name: "存储优化",
    icon: "HardDrive",
    description: "页面文件、NTFS 优化、磁盘服务",
    items: [
      { id: "disableLastAccess", name: "最后访问时间戳策略", description: "设置 NTFS 最后访问时间戳行为值", safetyLevel: "conservative", control: "select", options: fsutilBehaviorOptions },
      { id: "disableDot3Name", name: "8.3 短文件名策略", description: "设置 NTFS 8.3 短文件名行为值", safetyLevel: "conservative", control: "select", options: fsutilBehaviorOptions },
      { id: "optimizePagefile", name: "页面文件管理", description: "设置页面文件的管理方式", safetyLevel: "conservative", control: "select", options: pagefileOptions },
      { id: "disableSearchIndex", name: "Windows 搜索索引", description: "此状态已由 Windows Search 服务统一管理", safetyLevel: "balanced", control: "diagnostic" },
      { id: "disableNtfsLog", name: "NTFS USN 日志", description: "仅显示日志状态；不支持自动删除", safetyLevel: "extreme", control: "diagnostic" },
      { id: "disableHibernation", name: "休眠", description: "控制休眠和休眠文件", safetyLevel: "extreme", control: "switch", options: booleanOptions, transitionWarnings: transition(false, "关闭休眠后将无法使用休眠和混合睡眠，并会影响快速启动。", "high") },
    ],
  },
  {
    id: "ssdOptimization",
    name: "SSD 优化",
    icon: "Cpu",
    description: "TRIM、计划优化、预取、硬件状态",
    items: [
      { id: "enableTrim", name: "TRIM", description: "控制 SSD 的 TRIM 通知", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableDefrag", name: "计划驱动器优化", description: "由 Windows 管理 SSD 重新 TRIM，仅显示状态", safetyLevel: "conservative", control: "diagnostic" },
      { id: "disablePrefetch", name: "预取与 Superfetch", description: "设置预取和 Superfetch 模式", safetyLevel: "conservative", control: "select", options: prefetchOptions },
      { id: "enableWriteCache", name: "SSD 写入缓存", description: "显示存储驱动管理的写入缓存状态", safetyLevel: "balanced", control: "diagnostic", requiresHardware: { type: "ssd", condition: "present" } },
      { id: "checkAhci", name: "AHCI 模式", description: "检查 AHCI/SATA 控制器状态", safetyLevel: "conservative", control: "diagnostic", requiresHardware: { type: "ssd", condition: "present" } },
    ],
  },
  {
    id: "memoryOptimization",
    name: "内存优化",
    icon: "MemoryStick",
    description: "内存压缩、内存转储、系统缓存",
    items: [
      { id: "disableMemoryCompression", name: "内存压缩", description: "控制 Windows 内存压缩", safetyLevel: "balanced", control: "switch", options: booleanOptions, transitionWarnings: transition(false, "关闭内存压缩仅适合内存充足的设备。", "medium"), requiresHardware: { type: "ram", condition: ">=16GB" } },
      { id: "disableCrashDump", name: "系统内存转储", description: "设置蓝屏时生成的内存转储类型", safetyLevel: "balanced", control: "select", options: crashDumpOptions, transitionWarnings: transition(0, "关闭系统内存转储会降低蓝屏问题的可诊断性。", "medium") },
      { id: "largeSystemCache", name: "系统缓存模式", description: "选择桌面应用或大型系统缓存模式", safetyLevel: "extreme", control: "select", options: cacheModeOptions },
    ],
  },
  {
    id: "cpuOptimization",
    name: "CPU 优化",
    icon: "Gauge",
    description: "核心停车、计时器、平台时钟",
    items: [
      { id: "optimizeTimer", name: "系统计时器策略", description: "选择系统默认或固定平台计时策略", safetyLevel: "balanced", control: "select", options: timerModeOptions, transitionWarnings: transition("platformTick", "固定平台计时策略可能影响部分设备的延迟和功耗。", "medium") },
      { id: "disableHPET", name: "恢复默认计时器", description: "移除强制平台时钟设置，不直接开关硬件 HPET", safetyLevel: "extreme", control: "command", transitionWarnings: transition(true, "恢复默认计时器后，少数音频设备的时序表现可能发生变化。", "medium") },
      { id: "disableCoreParking", name: "CPU 核心停车", description: "设置交流供电时保持唤醒的核心比例", safetyLevel: "balanced", control: "select", options: coreParkingOptions, targetRange: { min: 0, max: 100 }, transitionWarnings: transition(100, "关闭核心停车会增加处理器功耗和发热。", "medium") },
    ],
  },
  {
    id: "gpuOptimization",
    name: "GPU 优化",
    icon: "Monitor",
    description: "硬件调度、全屏优化、GPU 优先级",
    items: [
      { id: "hwSchedule", name: "硬件加速 GPU 调度", description: "设置硬件加速 GPU 调度策略", safetyLevel: "conservative", control: "select", options: hardwareSchedulingOptions },
      { id: "disableFullscreenOpt", name: "全屏优化", description: "控制 Windows 全屏优化", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "gpuPriority", name: "游戏 GPU 优先级", description: "设置游戏任务的 GPU 调度优先级", safetyLevel: "balanced", control: "select", options: gpuPriorityOptions, targetRange: { min: 0, max: 31 } },
      { id: "aeroPeek", name: "Aero Peek", description: "控制桌面窗口管理器的 Aero Peek 效果", safetyLevel: "extreme", control: "switch", options: booleanOptions },
      { id: "nvidiaOptimize", name: "NVIDIA GPU 性能配置", description: "对检测到的 NVIDIA 显卡应用性能配置", safetyLevel: "balanced", control: "command", requiresHardware: { type: "gpu", condition: "NVIDIA" } },
      { id: "amdOptimize", name: "AMD GPU 性能配置", description: "对检测到的 AMD 显卡应用性能配置", safetyLevel: "balanced", control: "command", requiresHardware: { type: "gpu", condition: "AMD" } },
    ],
  },
  {
    id: "networkOptimization",
    name: "网络优化",
    icon: "Wifi",
    description: "Nagle 算法、TCP、DNS、网卡节能",
    items: [
      { id: "disableNagle", name: "Nagle 算法", description: "控制活动物理网卡的 Nagle 算法", safetyLevel: "conservative", control: "switch", options: booleanOptions, requiresHardware: { type: "nic", condition: "connected" } },
      { id: "disableThrottling", name: "多媒体网络节流", description: "控制 Windows 多媒体网络节流", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "optimizeTcp", name: "TCP 全局设置", description: "保留 Windows 默认协议栈设置，仅显示状态", safetyLevel: "balanced", control: "diagnostic" },
      { id: "disableBandwidthLimit", name: "策略预留带宽", description: "设置组策略中的非尽力而为带宽预留比例", safetyLevel: "conservative", control: "select", options: bandwidthOptions, targetRange: { min: 0, max: 100 } },
      { id: "optimizeDns", name: "DNS 服务器", description: "选择自动获取或 Cloudflare DNS", safetyLevel: "balanced", control: "select", options: dnsOptions, requiresHardware: { type: "nic", condition: "connected" } },
      { id: "disableDeliveryOpt", name: "Delivery Optimization", description: "此状态已由 P2P 更新分发项统一管理", safetyLevel: "balanced", control: "diagnostic" },
      { id: "disableNicPowerSave", name: "网卡节能", description: "设置活动物理网卡的节能功能", safetyLevel: "balanced", control: "select", options: nicPowerOptions, requiresHardware: { type: "nic", condition: "connected" } },
    ],
  },
  {
    id: "uiOptimization",
    name: "界面优化",
    icon: "Palette",
    description: "透明、动画、桌面功能和视觉效果",
    items: [
      { id: "disableTransparency", name: "透明效果", description: "控制窗口和任务栏的透明效果", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableAnimations", name: "窗口动画", description: "控制窗口打开、关闭和最小化动画", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableShadows", name: "窗口和菜单阴影", description: "控制窗口和菜单阴影", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableSnapAssist", name: "Snap Assist", description: "控制窗口吸附辅助", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableWidgets", name: "Widgets", description: "控制任务栏 Widgets", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableCopilot", name: "Copilot", description: "控制 Windows Copilot", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableNotificationCenter", name: "通知中心", description: "控制通知中心和日历面板", safetyLevel: "extreme", control: "switch", options: booleanOptions, transitionWarnings: transition(false, "关闭通知中心后将无法接收系统和应用通知。", "high") },
      { id: "performanceVisualEffects", name: "视觉效果模式", description: "选择 Windows 视觉效果策略", safetyLevel: "balanced", control: "select", options: visualEffectsOptions },
    ],
  },
  {
    id: "privacyOptimization",
    name: "隐私优化",
    icon: "Shield",
    description: "诊断数据、广告 ID、活动和位置",
    items: [
      { id: "telemetryMinimal", name: "诊断数据级别", description: "设置 Windows 发送的诊断数据级别", safetyLevel: "conservative", control: "select", options: telemetryOptions },
      { id: "disableAdId", name: "广告 ID", description: "控制应用广告标识符", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableActivityHistory", name: "活动历史记录", description: "控制 Windows 活动历史记录", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableLocation", name: "位置服务", description: "控制系统和应用的位置访问", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "disableDiagViewer", name: "诊断数据查看器", description: "控制诊断数据查看器", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableSuggestions", name: "个性化建议", description: "控制系统个性化内容建议", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableStartSuggestions", name: "开始菜单建议", description: "控制开始菜单中的推荐内容", safetyLevel: "conservative", control: "switch", options: booleanOptions },
      { id: "disableCortana", name: "Cortana", description: "控制 Cortana 语音助手", safetyLevel: "conservative", control: "switch", options: booleanOptions },
    ],
  },
  {
    id: "securityOptimization",
    name: "安全优化",
    icon: "Lock",
    description: "Defender、DEP 和 CPU 漏洞缓解",
    items: [
      { id: "defenderExclusions", name: "游戏目录 Defender 排除项", description: "将检测到的游戏目录加入 Defender 排除项", safetyLevel: "conservative", control: "command", transitionWarnings: transition(true, "加入 Defender 排除项的目录不会被常规实时扫描。", "high") },
      { id: "optimizeScanSchedule", name: "仅空闲时扫描", description: "控制 Defender 计划扫描是否只在系统空闲时运行", safetyLevel: "balanced", control: "switch", options: booleanOptions },
      { id: "optimizeDEP", name: "DEP 模式", description: "设置数据执行保护范围", safetyLevel: "extreme", control: "select", options: depOptions, transitionWarnings: transition("OptIn", "仅保护系统程序会降低其他程序获得的 DEP 保护。", "high") },
      { id: "reduceMitigations", name: "CPU 漏洞缓解", description: "设置 Spectre/Meltdown 等 CPU 漏洞缓解策略", safetyLevel: "extreme", control: "select", options: mitigationOptions, transitionWarnings: transition("reduced", "降低 CPU 漏洞缓解会暴露已知的处理器安全风险。", "high") },
    ],
  },
];

export function getOptimizationItem(categoryId: string, itemId: string) {
  return categories.find((category) => category.id === categoryId)?.items.find((item) => item.id === itemId);
}

export function isOptimizationTargetAllowed(
  item: OptimizationCategory["items"][number],
  value: TargetValue,
): boolean {
  if (item.options?.some((option) => Object.is(option.value, value))) return true;
  if (
    typeof value === "number"
    && Number.isInteger(value)
    && item.targetRange
    && value >= item.targetRange.min
    && value <= item.targetRange.max
  ) {
    return true;
  }
  return typeof value === "string" && !!item.targetPattern && new RegExp(item.targetPattern).test(value);
}

export function isPreserveOnlyTarget(
  item: OptimizationCategory["items"][number],
  value: TargetValue,
): boolean {
  if (
    item.id === "ultimatePerformancePlan"
    && typeof value === "string"
    && !!item.targetPattern
    && new RegExp(item.targetPattern).test(value)
  ) return true;
  return !!item.options?.some((option) => option.preserveOnly && Object.is(option.value, value));
}
