#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "NativeCommand.psm1") -Force

function Invoke-SystemStatusNativeProbe {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    try {
        $result = Invoke-CheckedNativeCommand -FilePath $FilePath -ArgumentList $ArgumentList -AllowMissingCommand
        if ($result.Success) { return $result }
    } catch {}
    return $null
}

function Get-RegistryValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path -ErrorAction Stop)) { return $null }
    $item = Get-ItemProperty -LiteralPath $Path -ErrorAction Stop
    $property = $item.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-PowerSettingAcValue {
    param([string]$Subgroup, [string]$Setting)
    try {
        $result = Invoke-SystemStatusNativeProbe -FilePath "powercfg.exe" -ArgumentList @("/qh", "SCHEME_CURRENT", $Subgroup, $Setting)
        if ($null -eq $result) { return $null }
        $output = @($result.Output)
        $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        $matches = [regex]::Matches($text, '(?i)0x([0-9a-f]{8})')
        if ($matches.Count -lt 2) { return $null }
        return [Convert]::ToUInt32($matches[$matches.Count - 2].Groups[1].Value, 16)
    } catch { return $null }
}

function New-SystemItemStatus {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("boolean", "enum", "numeric", "command", "diagnostic")][string]$Kind,
        $CurrentValue,
        [bool]$Available = $true,
        [string]$Description = "",
        [string]$BlockedReason = "",
        [bool]$Applicable = $true,
        [bool]$StateConsistent = $true,
        [object[]]$BlockedTargets = @()
    )

    if (-not $Description) {
        if (-not $Applicable) {
            $Description = "当前状态：不适用"
        } elseif (-not $Available) {
            $Description = "无法读取当前状态"
        } elseif ($CurrentValue -is [bool]) {
            $Description = if ($CurrentValue) { "当前状态：启用" } else { "当前状态：关闭" }
        } elseif ($null -eq $CurrentValue) {
            $Description = "当前状态：不适用"
        } else {
            $Description = "当前值：$CurrentValue"
        }
    }

    $result = [ordered]@{
        kind = $Kind
        currentValue = $CurrentValue
        available = $Available
        applicable = $Applicable
        stateConsistent = $StateConsistent
        description = $Description
    }
    if ($BlockedReason) { $result.blockedReason = $BlockedReason }
    if ($BlockedTargets.Count -gt 0) { $result.blockedTargets = @($BlockedTargets) }
    return $result
}

function Get-SystemStatus {
    $status = @{}

    # --- Windows Update ---
    $status.windowsUpdate = @{}

    $disableP2P = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" "DODownloadMode"
    $status.windowsUpdate.disableP2P = @{ current = ($disableP2P -eq 0); description = if ($disableP2P -eq 0) { "P2P disabled (optimized)" } else { "P2P enabled (default)" } }

    $deferQualityUpdatesEnabled = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "DeferQualityUpdates"
    $deferQualityUpdates = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "DeferQualityUpdatesPeriodInDays"
    $status.windowsUpdate.deferQualityUpdates = @{ current = ($deferQualityUpdates -ge 7); description = if ($deferQualityUpdates -ge 7) { "Deferred >=7 days (optimized)" } else { "Deferred <7 days (default)" } }

    $deferFeatureUpdatesEnabled = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "DeferFeatureUpdates"
    $deferFeatureUpdates = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "DeferFeatureUpdatesPeriodInDays"
    $status.windowsUpdate.deferFeatureUpdates = @{ current = ($deferFeatureUpdates -ge 30); description = if ($deferFeatureUpdates -ge 30) { "Deferred >=30 days (optimized)" } else { "Deferred <30 days (default)" } }

    $disableAutoDriverUpdate = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "ExcludeWUDriversInQualityUpdate"
    $status.windowsUpdate.disableAutoDriverUpdate = @{ current = ($disableAutoDriverUpdate -eq 1); description = if ($disableAutoDriverUpdate -eq 1) { "Auto driver update disabled (optimized)" } else { "Auto driver update enabled (default)" } }

    $disableAutoUpdate = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" "NoAutoUpdate"
    $status.windowsUpdate.disableAutoUpdate = @{ current = ($disableAutoUpdate -eq 1); description = if ($disableAutoUpdate -eq 1) { "Auto update disabled (optimized)" } else { "Auto update enabled (default)" } }

    # --- Boot Optimization ---
    $status.bootOptimization = @{}

    $fastStartup = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" "HiberbootEnabled"
    $hibernateSupport = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Power" "HibernateEnabled"
    if ($null -eq $hibernateSupport) {
        $hibernateSupport = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Power" "HibernateEnabledDefault"
    }
    $fastStartupAvailable = ($null -ne $hibernateSupport)
    $isFastStartupEnabled = if ($fastStartupAvailable) { ($hibernateSupport -ne 0) -and ($null -eq $fastStartup -or $fastStartup -ne 0) } else { $null }
    $status.bootOptimization.fastStartup = @{ current = $isFastStartupEnabled; description = if ($isFastStartupEnabled) { "Fast startup enabled" } else { "Fast startup disabled" } }

    $bcdResult = Invoke-SystemStatusNativeProbe -FilePath "bcdedit.exe"
    $bcdeditOutput = if ($null -eq $bcdResult) { @() } else { @($bcdResult.Output) }
    $bcdAccessible = ($null -ne $bcdResult)
    $bootLog = ($bcdeditOutput | Where-Object { $_ -match "bootlog\s+(yes|no)" })
    $isBootLogDisabled = $bcdAccessible -and ((-not $bootLog) -or ($bootLog -match "(?i)no\s*$"))
    $status.bootOptimization.disableBootLog = @{ current = $isBootLogDisabled; description = if ($isBootLogDisabled) { "Boot log disabled (optimized)" } else { "Boot log enabled (default)" } }

    $bootTimeout = ($bcdeditOutput | Where-Object { $_ -match "timeout\s+(\d+)" })
    if ($bootTimeout -match "timeout\s+(\d+)") { $timeoutVal = [int]$Matches[1] } else { $timeoutVal = 30 }
    $status.bootOptimization.reduceBootTimeout = @{ current = ($timeoutVal -eq 0); description = if ($timeoutVal -eq 0) { "Timeout: 0s (optimized)" } else { "Timeout: $($timeoutVal)s (default)" } }

    $numprocLine = ($bcdeditOutput | Where-Object { $_ -match "numproc\s+" })
    $usesAllBootProcessors = $bcdAccessible -and (-not [bool]$numprocLine)
    $status.bootOptimization.bootProcessorsFull = @{ current = $usesAllBootProcessors; description = if ($usesAllBootProcessors) { "No boot processor limit" } else { "Boot processor count is limited" } }

    $disableStartupSound = Get-RegistryValue "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI\BootAnimation" "DisableStartupSound"
    $status.bootOptimization.disableStartupSound = @{ current = ($disableStartupSound -eq 1); description = if ($disableStartupSound -eq 1) { "Startup sound disabled (optimized)" } else { "Startup sound enabled (default)" } }

    # --- Task Scheduling ---
    $status.taskScheduling = @{}

    $enableGameMode = Get-RegistryValue "HKCU:\Software\Microsoft\GameBar" "AllowAutoGameMode"
    $isGameModeEnabled = ($null -eq $enableGameMode -or $enableGameMode -ne 0)
    $status.taskScheduling.enableGameMode = @{ current = $isGameModeEnabled; description = if ($isGameModeEnabled) { "Game mode enabled" } else { "Game mode disabled" } }

    $fgPriority = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl" "Win32PrioritySeparation"
    $status.taskScheduling.foregroundPriority = @{ current = ($fgPriority -eq 38); description = if ($fgPriority -eq 38) { "Foreground priority enabled (optimized)" } else { "Default scheduling" } }

    $disableBackgroundApps = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy" "LetAppsRunInBackground"
    $status.taskScheduling.disableBackgroundApps = @{ current = ($disableBackgroundApps -eq 2); description = if ($disableBackgroundApps -eq 2) { "Background apps force-disabled (optimized)" } else { "Background apps allowed (default)" } }

    $disableGameDVR = Get-RegistryValue "HKCU:\System\GameConfigStore" "GameDVR_Enabled"
    $status.taskScheduling.disableGameDVR = @{ current = ($disableGameDVR -eq 0); description = if ($disableGameDVR -eq 0) { "GameDVR disabled (optimized)" } else { "GameDVR enabled (default)" } }

    # --- Service Optimization ---
    # A true current value always means the optimization is already applied.
    $status.serviceOptimization = @{}

    $serviceMap = @{
        "telemetry" = "DiagTrack"
        "fax" = "Fax"
        "remoteRegistry" = "RemoteRegistry"
        "errorReporting" = "WerSvc"
        "sysMain" = "SysMain"
        "windowsSearch" = "WSearch"
        "xboxAuth" = "XblAuthManager"
        "xboxGameSave" = "XblGameSave"
        "xboxNetwork" = "XboxNetApiSvc"
        "xboxGip" = "XboxGipSvc"
        "diagHub" = "diagnosticshub.standardcollector.service"
        "bluetooth" = "bthserv"
    }

    foreach ($key in $serviceMap.Keys) {
        $svcName = $serviceMap[$key]
        try {
            $svc = Get-Service -Name $svcName -ErrorAction Stop
            $startupType = $svc.StartType.ToString()
            $isDisabled = ($startupType -eq "Disabled")
            $isManual = ($startupType -eq "Manual")
            $status.serviceOptimization.$key = @{
                current = ($isDisabled -or $isManual)
                description = "${svcName}: $startupType"
            }
        } catch {
            $status.serviceOptimization.$key = @{
                current = $false
                description = "${svcName}: not found"
            }
        }
    }

    # PrintSpooler special handling (skip if printer exists)
    $printers = @()
    $printerProbeAvailable = $false
    try {
        $printers = @(Get-CimInstance Win32_Printer -ErrorAction Stop | Where-Object { $_.Name -notmatch "Microsoft Print|OneNote|XPS" })
        $printerProbeAvailable = $true
        $spoolerSvc = Get-Service -Name Spooler -ErrorAction Stop
        if ($printers) {
            $status.serviceOptimization.printSpooler = @{
                current = $false
                description = "Spooler: Auto (printer detected)"
            }
        } else {
            $currentSpooler = ($spoolerSvc.StartType -eq "Disabled" -or $spoolerSvc.StartType -eq "Manual")
            $status.serviceOptimization.printSpooler = @{
                current = $currentSpooler
                description = "Spooler: $($spoolerSvc.StartType)"
            }
        }
    } catch {
        $status.serviceOptimization.printSpooler = @{
            current = $false
            description = "Spooler: not found"
        }
    }

    # --- Power Management ---
    $status.powerManagement = @{}

    $activeSchemeResult = Invoke-SystemStatusNativeProbe -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
    $activeScheme = if ($null -eq $activeSchemeResult) { @() } else { @($activeSchemeResult.Output) }
    $activeSchemeAvailable = ($null -ne $activeSchemeResult)
    $isUltimate = $activeScheme -match "(?i)e9a42b02-d5df-448d-aa00-03f14749eb61|Win11 Gaming Ultimate Performance"
    $status.powerManagement.ultimatePerformancePlan = @{ current = [bool]$isUltimate; description = if ($isUltimate) { "Ultimate Performance plan active (optimized)" } else { "Non-ultimate power plan (default)" } }

    $minProc = Get-PowerSettingAcValue -Subgroup "SUB_PROCESSOR" -Setting "PROCTHROTTLEMIN"
    $isMin100 = ($null -ne $minProc -and $minProc -eq 100)
    $status.powerManagement.minProcessorState100 = @{ current = [bool]$isMin100; description = if ($isMin100) { "Min processor state: 100% (optimized)" } else { "Min processor state: default" } }

    $disablePowerThrottling = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Power" "PowerThrottlingOff"
    $status.powerManagement.disablePowerThrottling = @{ current = ($disablePowerThrottling -eq 1); description = if ($disablePowerThrottling -eq 1) { "Power throttling disabled (optimized)" } else { "Power throttling enabled (default)" } }

    $usbSuspend = Get-PowerSettingAcValue -Subgroup "2a737441-1930-4402-8d77-b2bebba308a3" -Setting "48e6b7a6-50f5-4782-a5d4-53bb8f07e226"
    $isUsbOff = ($null -ne $usbSuspend -and $usbSuspend -eq 0)
    $status.powerManagement.disableUsbSuspend = @{ current = [bool]$isUsbOff; description = if ($isUsbOff) { "USB selective suspend disabled (optimized)" } else { "USB selective suspend enabled (default)" } }

    $pcieLpm = Get-PowerSettingAcValue -Subgroup "501a4d13-42af-4429-9fd1-a8218c268e20" -Setting "ee12f906-d277-404b-b6da-e5fa1a576df5"
    $isPcieOff = ($null -ne $pcieLpm -and $pcieLpm -eq 0)
    $status.powerManagement.disablePcieLpm = @{ current = [bool]$isPcieOff; description = if ($isPcieOff) { "PCIe LPM disabled (optimized)" } else { "PCIe LPM enabled (default)" } }

    $diskAutoOff = Get-PowerSettingAcValue -Subgroup "0012ee47-9041-4b5d-9b77-535fba8b1442" -Setting "6738e2c4-e8a5-4a42-b16a-e040e769756e"
    $isDiskOff = ($null -ne $diskAutoOff -and $diskAutoOff -eq 0)
    $status.powerManagement.disableDiskAutoOff = @{ current = [bool]$isDiskOff; description = if ($isDiskOff) { "Disk auto-off disabled (optimized)" } else { "Disk auto-off enabled (default)" } }

    $boostMode = Get-PowerSettingAcValue -Subgroup "SUB_PROCESSOR" -Setting "PERFBOOSTMODE"
    $isAggressive = ($null -ne $boostMode -and $boostMode -eq 2)
    $status.powerManagement.aggressiveBoost = @{ current = [bool]$isAggressive; description = if ($isAggressive) { "Aggressive boost mode active (optimized)" } else { "Boost mode: default" } }

    # --- Storage Optimization ---
    $status.storageOptimization = @{}

    $disableHibernation = $hibernateSupport
    $status.storageOptimization.disableHibernation = @{ current = ($disableHibernation -eq 0); description = if ($disableHibernation -eq 0) { "Hibernation disabled (optimized)" } else { "Hibernation enabled (default)" } }

    $disableLastAccess = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" "NtfsDisableLastAccessUpdate"
    $status.storageOptimization.disableLastAccess = @{ current = ($disableLastAccess -eq 1); description = if ($disableLastAccess -eq 1) { "Last access time tracking disabled (optimized)" } else { "Last access time tracking enabled (default)" } }

    $disableDot3Name = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" "NtfsDisable8dot3NameCreation"
    $status.storageOptimization.disableDot3Name = @{ current = ($disableDot3Name -eq 1); description = if ($disableDot3Name -eq 1) { "8.3 short names disabled (optimized)" } else { "8.3 short names enabled (default)" } }

    $computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $isPagefileAutomatic = ($computerSystem -and [bool]$computerSystem.AutomaticManagedPagefile)
    $status.storageOptimization.optimizePagefile = @{ current = [bool]$isPagefileAutomatic; description = if ($isPagefileAutomatic) { "Pagefile: system-managed (optimized)" } else { "Pagefile: manually configured" } }

    $wsearchSvc = Get-Service -Name WSearch -ErrorAction SilentlyContinue
    $isWSearchManual = $wsearchSvc -and $wsearchSvc.StartType -eq "Manual"
    $status.storageOptimization.disableSearchIndex = @{ current = [bool]$isWSearchManual; description = if ($isWSearchManual) { "Windows Search: Manual (optimized)" } else { "Windows Search: default" } }

    $usnCommand = Invoke-SystemStatusNativeProbe -FilePath "fsutil.exe" -ArgumentList @("usn", "queryjournal", "C:")
    $usnResult = if ($null -eq $usnCommand) { @() } else { @($usnCommand.Output) }
    $usnAvailable = ($null -ne $usnCommand)
    $hasNtfsLog = $usnResult -match "UsnJournalID"
    $status.storageOptimization.disableNtfsLog = @{ current = $false; description = if ($hasNtfsLog) { "NTFS USN journal: active (automatic deletion is unsupported)" } else { "NTFS USN journal: unavailable" } }

    # --- SSD Optimization ---
    $status.ssdOptimization = @{}

    $trimCommand = Invoke-SystemStatusNativeProbe -FilePath "fsutil.exe" -ArgumentList @("behavior", "query", "DisableDeleteNotify")
    $trimStatus = if ($null -eq $trimCommand) { @() } else { @($trimCommand.Output) }
    $trimAvailable = ($null -ne $trimCommand)
    $isTrimDisabled = $trimStatus -match "DisableDeleteNotify\s*=\s*1"
    $status.ssdOptimization.enableTrim = @{ current = (-not [bool]$isTrimDisabled); description = if ($isTrimDisabled) { "TRIM disabled" } else { "TRIM enabled (default)" } }

    $status.ssdOptimization.disableDefrag = @{ current = $false; description = "Windows scheduled SSD retrim remains enabled (recommended)" }

    $prefetcher = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters" "EnablePrefetcher"
    $superfetch = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters" "EnableSuperfetch"
    $isPrefetchOff = ($prefetcher -eq 0) -and ($superfetch -eq 0)
    $status.ssdOptimization.disablePrefetch = @{ current = [bool]$isPrefetchOff; description = if ($isPrefetchOff) { "Prefetch/Superfetch: disabled" } else { "Prefetch/Superfetch: default" } }

    $status.ssdOptimization.enableWriteCache = @{ current = $false; description = "Write cache is managed by the storage driver" }

    $ahciController = Get-CimInstance Win32_IDEController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "AHCI|SATA" } | Select-Object -First 1
    $status.ssdOptimization.checkAhci = @{ current = [bool]$ahciController; description = if ($ahciController) { "AHCI/SATA controller detected" } else { "AHCI controller not detected" } }

    # --- Memory Optimization ---
    $status.memoryOptimization = @{}

    try {
        $mmAgent = Get-MMAgent -ErrorAction Stop
        $status.memoryOptimization.disableMemoryCompression = @{ current = (-not [bool]$mmAgent.MemoryCompression); description = if ($mmAgent.MemoryCompression) { "Memory compression: enabled" } else { "Memory compression: disabled" } }
    } catch {
        $status.memoryOptimization.disableMemoryCompression = @{ current = $false; description = "Memory compression: unable to detect" }
    }

    # FIX: CrashDumpEnabled null = automatic dump (default ON), only 0 = disabled
    $crashDump = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl" "CrashDumpEnabled"
    $status.memoryOptimization.disableCrashDump = @{ current = ($crashDump -eq 0); description = if ($crashDump -eq 0) { "Crash dump: disabled (optimized)" } elseif ($crashDump -eq $null) { "Crash dump: automatic (default)" } else { "Crash dump: enabled (value $crashDump)" } }

    $largeCache = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" "LargeSystemCache"
    $status.memoryOptimization.largeSystemCache = @{ current = ($largeCache -eq 0); description = if ($largeCache -eq 0) { "Desktop cache behavior active (optimized)" } else { "Large system cache enabled" } }

    # --- CPU Optimization ---
    $status.cpuOptimization = @{}

    $usePlatformTick = ($bcdeditOutput | Where-Object { $_ -match "useplatformtick" })
    $isPlatformTick = $bcdAccessible -and ($usePlatformTick -match "(?i)Yes")
    $disableDynTick = ($bcdeditOutput | Where-Object { $_ -match "disabledynamictick" })
    $isDynTickDisabled = $bcdAccessible -and ($disableDynTick -match "(?i)Yes")
    $status.cpuOptimization.optimizeTimer = @{ current = ($isPlatformTick -and $isDynTickDisabled); description = if ($isPlatformTick -and $isDynTickDisabled) { "Platform tick enabled and dynamic tick disabled" } else { "Timer: default" } }

    $usePlatformClock = ($bcdeditOutput | Where-Object { $_ -match "useplatformclock" })
    $isHPET = $usePlatformClock -match "(?i)Yes"
    $isHpetDisabled = $bcdAccessible -and (-not [bool]$isHPET)
    $status.cpuOptimization.disableHPET = @{ current = $isHpetDisabled; description = if (-not $bcdAccessible) { "HPET state unavailable" } elseif ($isHpetDisabled) { "Forced HPET platform clock disabled" } else { "Forced HPET platform clock enabled" } }

    $coreParking = Get-PowerSettingAcValue -Subgroup "54533251-82be-4824-96c1-47b60b740d00" -Setting "0cc5b647-c1df-4637-891a-dec35c318583"
    $isCoreParkingDisabled = ($null -ne $coreParking -and $coreParking -eq 100)
    $status.cpuOptimization.disableCoreParking = @{ current = [bool]$isCoreParkingDisabled; description = if ($isCoreParkingDisabled) { "All cores kept unparked on AC power" } else { "Core parking enabled (default)" } }

    # --- GPU Optimization ---
    $status.gpuOptimization = @{}

    $hwSchedule = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" "HwSchMode"
    $status.gpuOptimization.hwSchedule = @{ current = ($hwSchedule -eq 2); description = if ($hwSchedule -eq 2) { "Hardware GPU scheduling enabled" } else { "Hardware GPU scheduling disabled (default)" } }

    $fseBehavior = Get-RegistryValue "HKCU:\System\GameConfigStore" "GameDVR_FSEBehaviorMode"
    $fseHonor = Get-RegistryValue "HKCU:\System\GameConfigStore" "GameDVR_HonorUserFSEBehaviorMode"
    $isFullscreenOptOff = ($fseBehavior -eq 2) -and ($fseHonor -eq 1)
    $status.gpuOptimization.disableFullscreenOpt = @{ current = [bool]$isFullscreenOptOff; description = if ($isFullscreenOptOff) { "Fullscreen optimization disabled" } else { "Fullscreen optimization enabled (default)" } }

    $gpuPriority = Get-RegistryValue "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games" "GPU Priority"
    $status.gpuOptimization.gpuPriority = @{ current = ($gpuPriority -eq 8); description = if ($gpuPriority -eq 8) { "GPU priority: 8 (high)" } else { "GPU priority: default" } }

    $aeroPeekEnabled = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\Dwm" "EnableAeroPeek"
    $status.gpuOptimization.aeroPeek = @{ current = ($aeroPeekEnabled -ne 0); description = if ($aeroPeekEnabled -eq 0) { "Aero Peek disabled" } else { "Aero Peek enabled (default)" } }

    $nvidiaDetected = $false
    $amdDetected = $false
    $nvidiaOptimized = $false
    $amdOptimized = $false
    $gpuInventoryAvailable = $true
    $gpuDriverStateAvailable = $true
    $nvidiaAdapterCount = 0
    $nvidiaOptimizedCount = 0
    $amdAdapterCount = 0
    $amdOptimizedCount = 0
    try {
        $videoControllers = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name -notmatch "Microsoft|Basic|Remote" })
        $nvidiaDetected = @($videoControllers | Where-Object { $_.Name -match "NVIDIA|GeForce|RTX|GTX" }).Count -gt 0
        $amdDetected = @($videoControllers | Where-Object { $_.Name -match "AMD|Radeon|RX" }).Count -gt 0
    } catch {
        $gpuInventoryAvailable = $false
    }
    $displayClassPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
    try {
        $displayAdapters = @(Get-ChildItem -LiteralPath $displayClassPath -ErrorAction Stop | Where-Object { $_.PSChildName -match "^\d{4}$" })
        foreach ($adapter in $displayAdapters) {
            $adapterPath = Join-Path $displayClassPath $adapter.PSChildName
            $driverDescription = Get-RegistryValue $adapterPath "DriverDesc"
            if ($driverDescription -match "NVIDIA|GeForce") {
                $nvidiaAdapterCount++
                if ((Get-RegistryValue $adapterPath "PerfLevelSrc") -eq 8738) { $nvidiaOptimizedCount++ }
            }
            if ($driverDescription -match "AMD|Radeon") {
                $amdAdapterCount++
                if ((Get-RegistryValue $adapterPath "GpuWorkload") -eq 2) { $amdOptimizedCount++ }
            }
        }
        $nvidiaOptimized = $nvidiaAdapterCount -gt 0 -and $nvidiaOptimizedCount -eq $nvidiaAdapterCount
        $amdOptimized = $amdAdapterCount -gt 0 -and $amdOptimizedCount -eq $amdAdapterCount
    } catch {
        $gpuDriverStateAvailable = $false
    }
    $status.gpuOptimization.nvidiaOptimize = @{ current = $nvidiaOptimized; description = if ($nvidiaOptimized) { "NVIDIA max performance active" } else { "NVIDIA optimization not detected" } }
    $status.gpuOptimization.amdOptimize = @{ current = $amdOptimized; description = if ($amdOptimized) { "AMD GPU workload: graphics mode" } else { "AMD optimization not detected" } }

    # --- Network Optimization ---
    $status.networkOptimization = @{}

    $nicInventoryAvailable = $true
    try {
        $nics = @(Get-NetAdapter -ErrorAction Stop | Where-Object {
            $_.Status -eq "Up" -and $_.HardwareInterface -and $_.InterfaceDescription -notmatch "Virtual|VPN|TAP"
        })
    } catch {
        $nicInventoryAvailable = $false
        $nics = @()
    }

    $nicCount = @($nics).Count
    $nagleAllDisabled = ($nicCount -gt 0)
    $nagleAllEnabled = ($nicCount -gt 0)
    foreach ($nic in $nics) {
        $guid = ([string]$nic.InterfaceGuid).Trim("{}")
        if ($guid) {
            $ifacePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$guid}"
            $tcpAck = Get-RegistryValue $ifacePath "TcpAckFrequency"
            $tcpNoDelay = Get-RegistryValue $ifacePath "TCPNoDelay"
            $adapterDisabled = ($tcpAck -eq 1 -and $tcpNoDelay -eq 1)
            $adapterEnabled = ($null -eq $tcpAck -and $null -eq $tcpNoDelay)
            if (-not $adapterDisabled) { $nagleAllDisabled = $false }
            if (-not $adapterEnabled) { $nagleAllEnabled = $false }
        }
    }
    $nagleStateConsistent = if ($nicCount -eq 0) { $true } else { $nagleAllDisabled -or $nagleAllEnabled }
    $nagleValue = if ($nagleAllDisabled) { $false } elseif ($nagleAllEnabled) { $true } else { $null }
    $status.networkOptimization.disableNagle = @{ current = $nagleValue; description = if ($null -eq $nagleValue) { "Nagle state is mixed or unavailable" } elseif ($nagleValue) { "Nagle algorithm enabled" } else { "Nagle algorithm disabled" } }

    $netThrottle = Get-RegistryValue "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" "NetworkThrottlingIndex"
    $isThrottleOff = ($netThrottle -eq 4294967295)
    $status.networkOptimization.disableThrottling = @{ current = [bool]$isThrottleOff; description = if ($isThrottleOff) { "Network throttling disabled" } else { "Network throttling enabled (default)" } }

    $status.networkOptimization.optimizeTcp = @{ current = $false; description = "Legacy global TCP tweaks are intentionally not applied" }

    $disableBandwidthLimit = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched" "NonBestEffortLimit"
    $bandwidthLimitDisabled = ($null -eq $disableBandwidthLimit -or $disableBandwidthLimit -eq 0)
    $status.networkOptimization.disableBandwidthLimit = @{ current = $bandwidthLimitDisabled; description = if ($bandwidthLimitDisabled) { "Bandwidth limit removed" } else { "Bandwidth limit active" } }

    $hasCustomDns = (@($nics).Count -gt 0)
    $dnsProbeAvailable = $nicInventoryAvailable -and ($nicCount -gt 0)
    $hasStaticDns = $false
    $cloudflareServers = @("1.0.0.1", "1.1.1.1")
    foreach ($nic in $nics) {
        $nicHasCustomDns = $false
        $serverAddresses = @()
        $guid = ([string]$nic.InterfaceGuid).Trim("{}")
        $ifacePath = if ($guid) { "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$guid}" } else { $null }
        $nameServer = if ($ifacePath) { Get-RegistryValue $ifacePath "NameServer" } else { $null }
        if (-not [string]::IsNullOrWhiteSpace([string]$nameServer)) { $hasStaticDns = $true }
        if ($nic.InterfaceIndex -and $nic.InterfaceIndex -gt 0) {
            try {
                $dnsServers = @(Get-DnsClientServerAddress -InterfaceIndex $nic.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop)
                $serverAddresses = @($dnsServers | ForEach-Object { @($_.ServerAddresses) } | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
            } catch {
                $dnsProbeAvailable = $false
                $hasCustomDns = $false
                break
            }
        } elseif ($nic.InterfaceGuid) {
            $serverAddresses = @(([string]$nameServer -split '[,;\s]+' | Where-Object { $_ } | Select-Object -Unique | Sort-Object))
        } else {
            $dnsProbeAvailable = $false
            $hasCustomDns = $false
            break
        }
        $nicHasCustomDns = ($serverAddresses.Count -eq $cloudflareServers.Count -and ($serverAddresses -join ',') -eq ($cloudflareServers -join ','))
        if (-not $nicHasCustomDns) { $hasCustomDns = $false; break }
    }
    $status.networkOptimization.optimizeDns = @{ current = $hasCustomDns; description = if ($hasCustomDns) { "Cloudflare DNS configured" } else { "DNS: default or mixed" } }

    $disableDeliveryOpt = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" "DODownloadMode"
    $status.networkOptimization.disableDeliveryOpt = @{ current = ($disableDeliveryOpt -eq 0); description = if ($disableDeliveryOpt -eq 0) { "Delivery Optimization disabled (optimized)" } else { "Delivery Optimization enabled (default)" } }

    $nicPowerProbeAvailable = $nicInventoryAvailable -and ($nicCount -gt 0)
    $allNicPowerDisabled = $nicPowerProbeAvailable
    $allNicPowerEnabled = $nicPowerProbeAvailable
    $hasNicPowerSetting = $false
    $nicPowerPropertyNames = @("ArpOffload", "D0PacketCoalescing", "DeviceSleepOnDisconnect", "NSOffload", "RsnRekeyOffload", "SelectiveSuspend", "WakeOnMagicPacket", "WakeOnPattern")
    foreach ($nic in $nics) {
        if ($nic.Name -and $nic.Name -ne $nic.InterfaceGuid) {
            try {
                $powerMgmt = Get-NetAdapterPowerManagement -Name $nic.Name -ErrorAction Stop
            } catch {
                $nicPowerProbeAvailable = $false
                break
            }
            $adapterSettingCount = 0
            foreach ($propertyName in $nicPowerPropertyNames) {
                $property = $powerMgmt.PSObject.Properties[$propertyName]
                if ($null -eq $property -or @("Enabled", "Disabled") -notcontains [string]$property.Value) { continue }
                $adapterSettingCount++
                $hasNicPowerSetting = $true
                if ([string]$property.Value -eq "Enabled") { $allNicPowerDisabled = $false }
                if ([string]$property.Value -eq "Disabled") { $allNicPowerEnabled = $false }
            }
            if ($adapterSettingCount -eq 0) {
                $nicPowerProbeAvailable = $false
                break
            }
        } else {
            $nicPowerProbeAvailable = $false
            break
        }
    }
    if (-not $hasNicPowerSetting) { $nicPowerProbeAvailable = $false }
    $nicPowerValue = if (-not $nicPowerProbeAvailable) { $null } elseif ($allNicPowerDisabled) { "disabled" } elseif ($allNicPowerEnabled) { "enabled" } else { "mixed" }
    $status.networkOptimization.disableNicPowerSave = @{ current = $nicPowerValue; description = if ($nicPowerValue) { "NIC power save: $nicPowerValue" } else { "NIC power save: unavailable" } }

    # --- UI Optimization ---
    $status.uiOptimization = @{}

    $disableTransparency = Get-RegistryValue "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize" "EnableTransparency"
    $status.uiOptimization.disableTransparency = @{ current = ($disableTransparency -eq 0); description = if ($disableTransparency -eq 0) { "Transparency disabled (optimized)" } else { "Transparency enabled (default)" } }

    $minAnimate = Get-RegistryValue "HKCU:\Control Panel\Desktop\WindowMetrics" "MinAnimate"
    $status.uiOptimization.disableAnimations = @{ current = ($minAnimate -eq "0"); description = if ($minAnimate -eq "0") { "Window animations disabled (optimized)" } else { "Window animations enabled (default)" } }

    $disableShadows = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "ListviewShadow"
    $status.uiOptimization.disableShadows = @{ current = ($disableShadows -eq 0); description = if ($disableShadows -eq 0) { "Shadows disabled (optimized)" } else { "Shadows enabled (default)" } }

    $disableSnapAssist = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "SnapAssist"
    $status.uiOptimization.disableSnapAssist = @{ current = ($disableSnapAssist -eq 0); description = if ($disableSnapAssist -eq 0) { "Snap Assist disabled (optimized)" } else { "Snap Assist enabled (default)" } }

    $disableWidgets = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "TaskbarDa"
    $status.uiOptimization.disableWidgets = @{ current = ($disableWidgets -eq 0); description = if ($disableWidgets -eq 0) { "Widgets removed (optimized)" } else { "Widgets visible (default)" } }

    $disableCopilot = Get-RegistryValue "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" "TurnOffWindowsCopilot"
    $status.uiOptimization.disableCopilot = @{ current = ($disableCopilot -eq 1); description = if ($disableCopilot -eq 1) { "Copilot disabled (optimized)" } else { "Copilot enabled (default)" } }

    $disableNotificationCenter = Get-RegistryValue "HKCU:\Software\Policies\Microsoft\Windows\Explorer" "DisableNotificationCenter"
    $status.uiOptimization.disableNotificationCenter = @{ current = ($disableNotificationCenter -eq 1); description = if ($disableNotificationCenter -eq 1) { "Notification center disabled (optimized)" } else { "Notification center enabled (default)" } }

    $performanceVisualEffects = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects" "VisualFXSetting"
    $status.uiOptimization.performanceVisualEffects = @{ current = ($performanceVisualEffects -eq 2); description = if ($performanceVisualEffects -eq 2) { "Best performance visual effects (optimized)" } else { "Default visual effects" } }

    # --- Privacy Optimization ---
    $status.privacyOptimization = @{}

    $telemetry = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "AllowTelemetry"
    $isTelemetryMinimal = ($null -ne $telemetry -and $telemetry -le 1)
    $status.privacyOptimization.telemetryMinimal = @{ current = $isTelemetryMinimal; description = if ($isTelemetryMinimal) { "Telemetry: Minimal ($telemetry)" } else { "Telemetry: Default" } }

    $disableAdId = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo" "Enabled"
    $status.privacyOptimization.disableAdId = @{ current = ($disableAdId -eq 0); description = if ($disableAdId -eq 0) { "Ad ID disabled (optimized)" } else { "Ad ID enabled (default)" } }

    $disableActivityHistory = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "EnableActivityFeed"
    $status.privacyOptimization.disableActivityHistory = @{ current = ($disableActivityHistory -eq 0); description = if ($disableActivityHistory -eq 0) { "Activity history disabled (optimized)" } else { "Activity history enabled (default)" } }

    $disableLocation = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors" "DisableLocation"
    $status.privacyOptimization.disableLocation = @{ current = ($disableLocation -eq 1); description = if ($disableLocation -eq 1) { "Location tracking disabled (optimized)" } else { "Location tracking enabled (default)" } }

    # FIX: Use correct registry path matching PrivacyOptimization.psm1 (DiagnosticDataViewer, not EnableEventTranscript)
    $diagViewer = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "DiagnosticDataViewer"
    $status.privacyOptimization.disableDiagViewer = @{ current = ($diagViewer -ne 1); description = if ($diagViewer -eq 0 -or $diagViewer -eq $null) { "Diag viewer disabled (optimized)" } else { "Diag viewer enabled (default)" } }

    $disableSuggestions = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SubscribedContent-338389Enabled"
    $status.privacyOptimization.disableSuggestions = @{ current = ($disableSuggestions -eq 0); description = if ($disableSuggestions -eq 0) { "Suggestions disabled (optimized)" } else { "Suggestions enabled (default)" } }

    # FIX: Use correct registry path matching PrivacyOptimization.psm1 (SystemPaneSuggestionsEnabled, not Start_TrackProgs)
    $disableStartSuggestions = Get-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SystemPaneSuggestionsEnabled"
    $status.privacyOptimization.disableStartSuggestions = @{ current = ($disableStartSuggestions -eq 0); description = if ($disableStartSuggestions -eq 0) { "Start suggestions disabled (optimized)" } else { "Start suggestions enabled (default)" } }

    $disableCortana = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search" "AllowCortana"
    $status.privacyOptimization.disableCortana = @{ current = ($disableCortana -eq 0); description = if ($disableCortana -eq 0) { "Cortana disabled (optimized)" } else { "Cortana enabled (default)" } }

    # --- Security Optimization ---
    $status.securityOptimization = @{}

    $exclusionPaths = @()
    try { $mpPref = Get-MpPreference -ErrorAction Stop; $exclusionPaths = $mpPref.ExclusionPath } catch {}
    $hasExclusions = $exclusionPaths -and $exclusionPaths.Count -gt 0
    $status.securityOptimization.defenderExclusions = @{ current = [bool]$hasExclusions; description = if ($hasExclusions) { "Defender exclusions: $($exclusionPaths.Count) paths" } else { "No Defender exclusions configured" } }

    $idleScans = if ($mpPref) { [bool]$mpPref.ScanOnlyIfIdleEnabled } else { $false }
    $status.securityOptimization.optimizeScanSchedule = @{ current = $idleScans; description = if ($idleScans) { "Scheduled scans run only while idle" } else { "Scheduled scans may run while active" } }

    $depResult = Invoke-SystemStatusNativeProbe -FilePath "bcdedit.exe" -ArgumentList @("/enum", "{current}")
    $depOutput = if ($null -eq $depResult) { @() } else { @($depResult.Output) }
    $depExitCode = if ($null -eq $depResult) { 1 } else { 0 }
    $depNx = ($depOutput | Where-Object { $_ -match "nx\s+" })
    $isDepOptIn = ($depExitCode -eq 0) -and ($depNx -match "(?i)OptIn")
    $status.securityOptimization.optimizeDEP = @{ current = [bool]$isDepOptIn; description = if ($isDepOptIn) { "DEP: OptIn mode (system only)" } else { "DEP: default or stricter mode" } }

    $mitigations = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" "FeatureSettingsOverride"
    $status.securityOptimization.reduceMitigations = @{ current = ($mitigations -eq 3); description = if ($mitigations -eq 3) { "CPU mitigations reduced (high risk)" } else { "Default CPU mitigations" } }

    # Normalize every item to the v2 current-value contract. The legacy probes
    # above remain useful as raw readers, but their boolean "optimized" flags
    # are not exposed to the UI anymore.
    $status.windowsUpdate.disableP2P = New-SystemItemStatus boolean ($disableP2P -ne 0)
    $qualityDeferralConsistent = (($null -eq $deferQualityUpdatesEnabled -and $null -eq $deferQualityUpdates) -or ($deferQualityUpdatesEnabled -eq 1 -and $null -ne $deferQualityUpdates))
    $qualityDeferralValue = if ($null -eq $deferQualityUpdates) { "systemDefault" } else { [int]$deferQualityUpdates }
    $status.windowsUpdate.deferQualityUpdates = New-SystemItemStatus -Kind numeric -CurrentValue $qualityDeferralValue -StateConsistent $qualityDeferralConsistent
    $featureDeferralConsistent = (($null -eq $deferFeatureUpdatesEnabled -and $null -eq $deferFeatureUpdates) -or ($deferFeatureUpdatesEnabled -eq 1 -and $null -ne $deferFeatureUpdates))
    $featureDeferralValue = if ($null -eq $deferFeatureUpdates) { "systemDefault" } else { [int]$deferFeatureUpdates }
    $status.windowsUpdate.deferFeatureUpdates = New-SystemItemStatus -Kind numeric -CurrentValue $featureDeferralValue -StateConsistent $featureDeferralConsistent
    $status.windowsUpdate.disableAutoDriverUpdate = New-SystemItemStatus boolean ($disableAutoDriverUpdate -ne 1)
    $status.windowsUpdate.disableAutoUpdate = New-SystemItemStatus boolean ($disableAutoUpdate -ne 1)

    $status.bootOptimization.fastStartup = New-SystemItemStatus boolean $isFastStartupEnabled $fastStartupAvailable
    $bootLogValue = if (-not $bcdAccessible) { $null } elseif ($bootLog -match "(?i)yes\s*$") { $true } else { $false }
    $status.bootOptimization.disableBootLog = New-SystemItemStatus boolean $bootLogValue $bcdAccessible
    $bootTimeoutValue = if (-not $bcdAccessible) { $null } elseif ($bootTimeout -match "timeout\s+(\d+)") { [int]$Matches[1] } else { "systemDefault" }
    $status.bootOptimization.reduceBootTimeout = New-SystemItemStatus numeric $bootTimeoutValue $bcdAccessible
    $status.bootOptimization.disableStartupSound = New-SystemItemStatus boolean ($disableStartupSound -ne 1)
    $status.bootOptimization.bootProcessorsFull = New-SystemItemStatus command $usesAllBootProcessors $bcdAccessible "检查并移除引导处理器数量限制"

    $status.taskScheduling.enableGameMode = New-SystemItemStatus boolean $isGameModeEnabled
    $status.taskScheduling.foregroundPriority = New-SystemItemStatus numeric $(if ($null -eq $fgPriority) { "systemDefault" } else { [int]$fgPriority })
    $backgroundValue = if ($disableBackgroundApps -eq 2) { "forceDeny" } elseif ($disableBackgroundApps -eq 1) { "forceAllow" } else { "userControl" }
    $status.taskScheduling.disableBackgroundApps = New-SystemItemStatus enum $backgroundValue
    $gameDvrPolicy = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" "AllowGameDVR"
    $gameDvrEnabled = -not ($disableGameDVR -eq 0 -or $gameDvrPolicy -eq 0)
    $status.taskScheduling.disableGameDVR = New-SystemItemStatus boolean $gameDvrEnabled

    $allServiceMap = [ordered]@{
        telemetry = "DiagTrack"; fax = "Fax"; remoteRegistry = "RemoteRegistry"; errorReporting = "WerSvc"
        printSpooler = "Spooler"; sysMain = "SysMain"; windowsSearch = "WSearch"; xboxAuth = "XblAuthManager"
        xboxGameSave = "XblGameSave"; xboxNetwork = "XboxNetApiSvc"; xboxGip = "XboxGipSvc"
        diagHub = "diagnosticshub.standardcollector.service"; bluetooth = "bthserv"
    }
    foreach ($entry in $allServiceMap.GetEnumerator()) {
        $serviceName = $entry.Value
        try {
            $service = Get-Service -Name $serviceName -ErrorAction Stop
        } catch {
            if ($_.FullyQualifiedErrorId -like "NoServiceFoundForGivenName*") {
                $status.serviceOptimization[$entry.Key] = New-SystemItemStatus -Kind enum -CurrentValue $null -Description "$serviceName：服务未安装，此项不适用" -Applicable $false
            } else {
                $status.serviceOptimization[$entry.Key] = New-SystemItemStatus -Kind enum -CurrentValue $null -Available $false -Description "$serviceName：无法读取服务状态"
            }
            continue
        }
        $startupType = if ($service.StartType.ToString() -eq "Disabled") {
            "disabled"
        } elseif ($service.StartType.ToString() -eq "Manual") {
            "manual"
        } elseif ([int](Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" "DelayedAutoStart") -eq 1) {
            "automaticDelayed"
        } else {
            "automatic"
        }
        $statusDescription = "$serviceName：$startupType"
        $blockedReasons = @()
        $blockedTargets = @()
        $serviceGroup = [string](Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" "Group")
        if (-not [string]::IsNullOrWhiteSpace($serviceGroup)) {
            $blockedReasons += "服务属于加载顺序组 [$serviceGroup]，Windows 不允许设置为自动（延迟启动）"
            $blockedTargets += "automaticDelayed"
        }
        if ($entry.Key -eq "printSpooler") {
            if (-not $printerProbeAvailable) {
                $statusDescription = "Spooler：无法确认实体打印机状态"
                $blockedReasons += "无法确认是否连接实体打印机，不能安全禁用打印服务"
                $blockedTargets += "disabled"
            } elseif ($printers.Count -gt 0) {
                $blockedReasons += "检测到实体打印机，不能禁用打印服务"
                $blockedTargets += "disabled"
            }
        }
        if ($entry.Key -eq "bluetooth") {
            $bluetoothDevice = $null
            try {
                $bluetoothDevice = Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object {
                    $_.PNPClass -eq "Bluetooth" -or $_.ClassGuid -eq "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}" -or $_.Name -match "Bluetooth"
                } | Select-Object -First 1
            } catch {
                $statusDescription = "bthserv：无法确认蓝牙硬件状态"
                $blockedReasons += "无法确认是否存在蓝牙设备，不能安全禁用蓝牙支持服务"
                $blockedTargets += "disabled"
            }
            if ($bluetoothDevice) {
                $blockedReasons += "检测到蓝牙设备，不能禁用蓝牙支持服务"
                $blockedTargets += "disabled"
            }
        }
        $status.serviceOptimization[$entry.Key] = New-SystemItemStatus -Kind enum -CurrentValue $startupType -Description $statusDescription -BlockedReason ($blockedReasons -join "；") -BlockedTargets $blockedTargets
    }

    $activeSchemeOutput = @($activeScheme)
    $activeSchemeText = ($activeSchemeOutput | ForEach-Object { $_.ToString() }) -join " "
    $activeSchemeGuid = if ($activeSchemeText -match '(?i)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { $Matches[1].ToLowerInvariant() } else { $null }
    $activeSchemeValue = if ($activeSchemeText -match "Win11 Gaming Ultimate Performance") { "ultimatePerformance" } elseif ($activeSchemeGuid -eq "381b4222-f694-41f0-9685-ff5bb260df2e") { "balanced" } else { $activeSchemeGuid }
    $status.powerManagement.ultimatePerformancePlan = New-SystemItemStatus enum $activeSchemeValue $activeSchemeAvailable
    $status.powerManagement.minProcessorState100 = New-SystemItemStatus numeric $minProc ($null -ne $minProc)
    $status.powerManagement.disablePowerThrottling = New-SystemItemStatus boolean ($disablePowerThrottling -ne 1)
    $status.powerManagement.disableUsbSuspend = New-SystemItemStatus boolean $(if ($null -eq $usbSuspend) { $null } else { $usbSuspend -ne 0 }) ($null -ne $usbSuspend)
    $status.powerManagement.disablePcieLpm = New-SystemItemStatus enum $pcieLpm ($null -ne $pcieLpm)
    $status.powerManagement.disableDiskAutoOff = New-SystemItemStatus numeric $diskAutoOff ($null -ne $diskAutoOff)
    $status.powerManagement.aggressiveBoost = New-SystemItemStatus enum $boostMode ($null -ne $boostMode)

    $hibernationAvailable = ($null -ne $disableHibernation)
    $hibernationValue = if ($hibernationAvailable) { $disableHibernation -ne 0 } else { $null }
    $status.storageOptimization.disableHibernation = New-SystemItemStatus boolean $hibernationValue $hibernationAvailable
    $status.storageOptimization.disableLastAccess = New-SystemItemStatus enum $(if ($null -eq $disableLastAccess) { $null } else { [int]([int64]$disableLastAccess -band 3) }) ($null -ne $disableLastAccess)
    $status.storageOptimization.disableDot3Name = New-SystemItemStatus enum $(if ($null -eq $disableDot3Name) { $null } else { [int]$disableDot3Name }) ($null -ne $disableDot3Name)
    $pagefileSettings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)
    $pagefileValue = if (-not $computerSystem) { $null } elseif ($isPagefileAutomatic) { "systemManaged" } elseif ($pagefileSettings.Count -eq 0) { "disabled" } else { "custom" }
    $status.storageOptimization.optimizePagefile = New-SystemItemStatus enum $pagefileValue ($null -ne $computerSystem)
    $status.storageOptimization.disableSearchIndex = New-SystemItemStatus diagnostic $(if ($wsearchSvc) { $wsearchSvc.StartType.ToString() } else { $null }) ([bool]$wsearchSvc) "已合并到「Windows Search 索引」服务项"
    $usnOutput = @($usnResult)
    $status.storageOptimization.disableNtfsLog = New-SystemItemStatus diagnostic ($usnOutput -match "UsnJournalID") $usnAvailable "NTFS USN 日志仅供检查，不支持自动调整"

    $trimOutput = @($trimStatus)
    $trimText = ($trimOutput | ForEach-Object { $_.ToString() }) -join "`n"
    $trimEnabled = if (-not $trimAvailable) { $null } else { -not [bool]($trimText -match "DisableDeleteNotify\s*=\s*1") }
    $diskInventoryAvailable = $true
    try {
        $physicalDisks = @(Get-PhysicalDisk -ErrorAction Stop)
    } catch {
        $diskInventoryAvailable = $false
        $physicalDisks = @()
    }
    $ssdDisks = @($physicalDisks | Where-Object { $_.MediaType -eq "SSD" })
    $hddDisks = @($physicalDisks | Where-Object { $_.MediaType -eq "HDD" })
    $unknownDisks = @($physicalDisks | Where-Object { $_.MediaType -notin @("SSD", "HDD") })
    $ssdApplicable = $diskInventoryAvailable -and $ssdDisks.Count -gt 0
    $status.ssdOptimization.enableTrim = New-SystemItemStatus -Kind boolean -CurrentValue $trimEnabled -Available ($trimAvailable -and $diskInventoryAvailable) -Applicable $(if ($diskInventoryAvailable) { $ssdApplicable } else { $true })
    $status.ssdOptimization.disableDefrag = New-SystemItemStatus -Kind diagnostic -CurrentValue "windowsManaged" -Available $diskInventoryAvailable -Applicable $(if ($diskInventoryAvailable) { $ssdApplicable } else { $true }) -Description "Windows 会自动为 SSD 执行安全的重新 TRIM"
    $prefetchValue = if ($null -eq $prefetcher -and $null -eq $superfetch) { "systemDefault" } elseif ($prefetcher -eq 0 -and $superfetch -eq 0) { "disabled" } elseif ($prefetcher -eq 3 -and $superfetch -eq 3) { "enabled" } else { "custom" }
    $prefetchBlockedReason = ""
    if (-not $diskInventoryAvailable -or $physicalDisks.Count -eq 0 -or $unknownDisks.Count -gt 0) {
        $prefetchBlockedReason = "无法确认全部存储介质类型，不能安全关闭预取与 Superfetch"
    } elseif ($hddDisks.Count -gt 0) {
        $prefetchBlockedReason = "检测到 HDD 或混合存储，不能安全关闭预取与 Superfetch"
    }
    $status.ssdOptimization.disablePrefetch = New-SystemItemStatus -Kind enum -CurrentValue $prefetchValue -BlockedReason $prefetchBlockedReason -BlockedTargets $(if ($prefetchBlockedReason) { @("disabled") } else { @() })
    if (-not $diskInventoryAvailable) {
        $status.ssdOptimization.enableWriteCache = New-SystemItemStatus -Kind diagnostic -CurrentValue $null -Available $false -Description "无法读取 SSD 写入缓存能力"
    } elseif (-not $ssdApplicable) {
        $status.ssdOptimization.enableWriteCache = New-SystemItemStatus -Kind diagnostic -CurrentValue $null -Available $true -Applicable $false -Description "未检测到 SSD，此项不适用"
    } else {
        $status.ssdOptimization.enableWriteCache = New-SystemItemStatus -Kind diagnostic -CurrentValue "driverManaged" -Available $true -Description "检测到 $($ssdDisks.Count) 个 SSD；写入缓存由存储驱动管理"
    }
    $status.ssdOptimization.checkAhci = New-SystemItemStatus diagnostic ([bool]$ahciController) $true $(if ($ahciController) { "已检测到 AHCI/SATA 控制器" } else { "未检测到 AHCI 控制器" })

    try {
        $memoryCompression = [bool](Get-MMAgent -ErrorAction Stop).MemoryCompression
        $memoryCompressionBlockedReason = ""
        if ($memoryCompression) {
            if (-not $computerSystem) {
                $memoryCompressionBlockedReason = "无法验证物理内存容量，不能关闭内存压缩"
            } elseif (($computerSystem.TotalPhysicalMemory / 1GB) -lt 16) {
                $memoryCompressionBlockedReason = "物理内存不足 16 GB，不能关闭内存压缩"
            }
        }
        $status.memoryOptimization.disableMemoryCompression = New-SystemItemStatus boolean $memoryCompression $true "" $memoryCompressionBlockedReason
    } catch {
        $status.memoryOptimization.disableMemoryCompression = New-SystemItemStatus boolean $null $false
    }
    $status.memoryOptimization.disableCrashDump = New-SystemItemStatus enum $(if ($null -eq $crashDump) { "systemDefault" } else { [int]$crashDump })
    $status.memoryOptimization.largeSystemCache = New-SystemItemStatus enum $(if ($largeCache -eq 1) { "server" } else { "desktop" })

    $timerValue = if (-not $bcdAccessible) { $null } elseif ($isPlatformTick -and $isDynTickDisabled) { "platformTick" } elseif (-not $usePlatformTick -and -not $disableDynTick) { "systemDefault" } else { "custom" }
    $status.cpuOptimization.optimizeTimer = New-SystemItemStatus enum $timerValue $bcdAccessible
    $hpetValue = if (-not $bcdAccessible) { $null } elseif ($isHPET) { "forcedPlatformClock" } else { "systemDefault" }
    $status.cpuOptimization.disableHPET = New-SystemItemStatus command $hpetValue $bcdAccessible "一次性恢复 Windows 默认计时器选择"
    $status.cpuOptimization.disableCoreParking = New-SystemItemStatus numeric $coreParking ($null -ne $coreParking)

    $hwScheduleValue = if ($null -eq $hwSchedule) { "systemDefault" } elseif ($hwSchedule -eq 2) { "enabled" } elseif ($hwSchedule -eq 1) { "disabled" } else { "custom" }
    $status.gpuOptimization.hwSchedule = New-SystemItemStatus enum $hwScheduleValue
    $status.gpuOptimization.disableFullscreenOpt = New-SystemItemStatus boolean (-not $isFullscreenOptOff)
    $gamePriority = Get-RegistryValue "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games" "Priority"
    $gpuPriorityValue = if ($null -eq $gpuPriority -and $null -eq $gamePriority) {
        "systemDefault"
    } elseif ($null -ne $gpuPriority -and $gamePriority -eq 6) {
        [int]$gpuPriority
    } else {
        "custom"
    }
    $status.gpuOptimization.gpuPriority = New-SystemItemStatus -Kind numeric -CurrentValue $gpuPriorityValue
    $status.gpuOptimization.aeroPeek = New-SystemItemStatus boolean ($aeroPeekEnabled -ne 0)
    $status.gpuOptimization.nvidiaOptimize = if (-not $gpuInventoryAvailable) {
        New-SystemItemStatus -Kind command -CurrentValue $null -Available $false -Description "无法读取显示适配器状态"
    } elseif ($nvidiaDetected) {
        if (-not $gpuDriverStateAvailable -or $nvidiaAdapterCount -eq 0) {
            New-SystemItemStatus -Kind command -CurrentValue $false -Description "已检测到 NVIDIA GPU；可执行一次性驱动性能配置"
        } else {
            $consistent = $nvidiaOptimizedCount -eq 0 -or $nvidiaOptimizedCount -eq $nvidiaAdapterCount
            New-SystemItemStatus -Kind command -CurrentValue $nvidiaOptimized -StateConsistent $consistent -Description $(if (-not $consistent) { "NVIDIA GPU 的驱动性能设置不一致" } elseif ($nvidiaOptimized) { "已检测到 NVIDIA GPU；驱动性能设置已应用" } else { "已检测到 NVIDIA GPU；驱动性能设置未应用" })
        }
    } else {
        New-SystemItemStatus -Kind command -CurrentValue $null -Available $true -Applicable $false -Description "未检测到 NVIDIA GPU，此项不适用"
    }
    $status.gpuOptimization.amdOptimize = if (-not $gpuInventoryAvailable) {
        New-SystemItemStatus -Kind command -CurrentValue $null -Available $false -Description "无法读取显示适配器状态"
    } elseif ($amdDetected) {
        if (-not $gpuDriverStateAvailable -or $amdAdapterCount -eq 0) {
            New-SystemItemStatus -Kind command -CurrentValue $false -Description "已检测到 AMD GPU；可执行一次性驱动性能配置"
        } else {
            $consistent = $amdOptimizedCount -eq 0 -or $amdOptimizedCount -eq $amdAdapterCount
            New-SystemItemStatus -Kind command -CurrentValue $amdOptimized -StateConsistent $consistent -Description $(if (-not $consistent) { "AMD GPU 的驱动性能设置不一致" } elseif ($amdOptimized) { "已检测到 AMD GPU；驱动性能设置已应用" } else { "已检测到 AMD GPU；驱动性能设置未应用" })
        }
    } else {
        New-SystemItemStatus -Kind command -CurrentValue $null -Available $true -Applicable $false -Description "未检测到 AMD GPU，此项不适用"
    }

    $nicAvailable = $nicInventoryAvailable -and ($nicCount -gt 0)
    $nicApplicable = if ($nicInventoryAvailable) { $nicCount -gt 0 } else { $true }
    $nagleDescription = if (-not $nicInventoryAvailable) { "无法读取活动物理网卡" } elseif (-not $nicApplicable) { "未检测到活动物理网卡" } elseif (-not $nagleStateConsistent) { "活动物理网卡的 Nagle 状态不一致" } elseif ($nagleValue) { "活动物理网卡已启用 Nagle 算法" } else { "活动物理网卡已关闭 Nagle 算法" }
    $status.networkOptimization.disableNagle = New-SystemItemStatus -Kind boolean -CurrentValue $nagleValue -Available $nicAvailable -Applicable $nicApplicable -StateConsistent $nagleStateConsistent -Description $nagleDescription
    $status.networkOptimization.disableThrottling = New-SystemItemStatus boolean (-not $isThrottleOff)
    $status.networkOptimization.optimizeTcp = New-SystemItemStatus diagnostic "windowsDefault" $true "保留 Windows 默认 TCP 协议栈设置"
    $bandwidthValue = if ($null -eq $disableBandwidthLimit) { "systemDefault" } else { [int]$disableBandwidthLimit }
    $status.networkOptimization.disableBandwidthLimit = New-SystemItemStatus numeric $bandwidthValue
    $dnsValue = if (-not $nicAvailable -or -not $dnsProbeAvailable) { $null } elseif ($hasCustomDns) { "cloudflare" } elseif ($hasStaticDns) { "custom" } else { "automatic" }
    $status.networkOptimization.optimizeDns = New-SystemItemStatus -Kind enum -CurrentValue $dnsValue -Available $dnsProbeAvailable -Applicable $nicApplicable
    $status.networkOptimization.disableDeliveryOpt = New-SystemItemStatus diagnostic ($disableDeliveryOpt -ne 0) $true "已合并到「P2P 更新分发」项"
    $status.networkOptimization.disableNicPowerSave = New-SystemItemStatus -Kind enum -CurrentValue $nicPowerValue -Available $nicPowerProbeAvailable -Applicable $nicApplicable

    $status.uiOptimization.disableTransparency = New-SystemItemStatus boolean ($disableTransparency -ne 0)
    $status.uiOptimization.disableAnimations = New-SystemItemStatus boolean ([string]$minAnimate -ne "0")
    $status.uiOptimization.disableShadows = New-SystemItemStatus boolean ($disableShadows -ne 0)
    $status.uiOptimization.disableSnapAssist = New-SystemItemStatus boolean ($disableSnapAssist -ne 0)
    $status.uiOptimization.disableWidgets = New-SystemItemStatus boolean ($disableWidgets -ne 0)
    $status.uiOptimization.disableCopilot = New-SystemItemStatus boolean ($disableCopilot -ne 1)
    $status.uiOptimization.disableNotificationCenter = New-SystemItemStatus boolean ($disableNotificationCenter -ne 1)
    $visualValue = if ($null -eq $performanceVisualEffects) { "systemDefault" } else { @{ 0 = "systemDefault"; 1 = "appearance"; 2 = "performance"; 3 = "custom" }[[int]$performanceVisualEffects] }
    $status.uiOptimization.performanceVisualEffects = New-SystemItemStatus enum $visualValue

    $status.privacyOptimization.telemetryMinimal = New-SystemItemStatus enum $(if ($null -eq $telemetry) { "systemDefault" } else { [int]$telemetry })
    $status.privacyOptimization.disableAdId = New-SystemItemStatus boolean ($disableAdId -ne 0)
    $publishActivities = Get-RegistryValue "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "PublishUserActivities"
    $activityHistoryValue = -not ($disableActivityHistory -eq 0 -or $publishActivities -eq 0)
    $activityHistoryConsistent = (($null -eq $disableActivityHistory -and $null -eq $publishActivities) -or ($disableActivityHistory -eq 0 -and $publishActivities -eq 0) -or ($disableActivityHistory -eq 1 -and $publishActivities -eq 1))
    $status.privacyOptimization.disableActivityHistory = New-SystemItemStatus -Kind boolean -CurrentValue $activityHistoryValue -StateConsistent $activityHistoryConsistent
    $status.privacyOptimization.disableLocation = New-SystemItemStatus boolean ($disableLocation -ne 1)
    $status.privacyOptimization.disableDiagViewer = New-SystemItemStatus boolean ($diagViewer -ne 0)
    $status.privacyOptimization.disableSuggestions = New-SystemItemStatus boolean ($disableSuggestions -ne 0)
    $status.privacyOptimization.disableStartSuggestions = New-SystemItemStatus boolean ($disableStartSuggestions -ne 0)
    $status.privacyOptimization.disableCortana = New-SystemItemStatus boolean ($disableCortana -ne 0)

    $status.securityOptimization.defenderExclusions = New-SystemItemStatus command ([int]@($exclusionPaths).Count) ([bool]$mpPref) "一次性添加已发现的游戏目录"
    $status.securityOptimization.optimizeScanSchedule = New-SystemItemStatus boolean $(if ($mpPref) { [bool]$mpPref.ScanOnlyIfIdleEnabled } else { $null }) ([bool]$mpPref)
    $depValue = if ($depExitCode -ne 0) { $null } elseif ($depNx -match "nx\s+(\S+)") { $Matches[1] } else { "systemDefault" }
    $status.securityOptimization.optimizeDEP = New-SystemItemStatus enum $depValue ($null -ne $depValue)
    $mitigationMask = Get-RegistryValue "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" "FeatureSettingsOverrideMask"
    $mitigationIsDefault = ($null -eq $mitigations -and $null -eq $mitigationMask)
    $mitigationIsReduced = ($mitigations -eq 3 -and $mitigationMask -eq 3)
    $mitigationValue = if ($mitigationIsDefault) { "systemDefault" } elseif ($mitigationIsReduced) { "reduced" } else { $null }
    $mitigationKnown = $mitigationIsDefault -or $mitigationIsReduced
    $mitigationDescription = if ($mitigationKnown) { "" } else { "检测到不受支持的自定义 CPU 缓解策略" }
    $status.securityOptimization.reduceMitigations = New-SystemItemStatus -Kind enum -CurrentValue $mitigationValue -Available $mitigationKnown -Description $mitigationDescription -StateConsistent $mitigationKnown

    return $status
}

Export-ModuleMember -Function Get-SystemStatus
