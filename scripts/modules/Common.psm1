#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Logging.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "Service.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "HardwareDetect.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "RestorePoint.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "ChangeTracking.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "NativeCommand.psm1") -Force

$Script:ConfigItems = [ordered]@{
    windowsUpdate = @("disableP2P", "deferQualityUpdates", "deferFeatureUpdates", "disableAutoDriverUpdate", "disableAutoUpdate")
    bootOptimization = @("fastStartup", "disableBootLog", "reduceBootTimeout", "disableStartupSound", "bootProcessorsFull")
    taskScheduling = @("enableGameMode", "foregroundPriority", "disableBackgroundApps", "disableGameDVR")
    serviceOptimization = @("telemetry", "fax", "remoteRegistry", "errorReporting", "printSpooler", "sysMain", "windowsSearch", "xboxAuth", "xboxGameSave", "xboxNetwork", "xboxGip", "diagHub", "bluetooth")
    powerManagement = @("ultimatePerformancePlan", "minProcessorState100", "disablePowerThrottling", "disableUsbSuspend", "disablePcieLpm", "disableDiskAutoOff", "aggressiveBoost")
    storageOptimization = @("disableLastAccess", "disableDot3Name", "optimizePagefile", "disableSearchIndex", "disableNtfsLog", "disableHibernation")
    ssdOptimization = @("enableTrim", "disableDefrag", "disablePrefetch", "enableWriteCache", "checkAhci")
    memoryOptimization = @("disableMemoryCompression", "disableCrashDump", "largeSystemCache")
    cpuOptimization = @("optimizeTimer", "disableHPET", "disableCoreParking")
    gpuOptimization = @("hwSchedule", "disableFullscreenOpt", "gpuPriority", "aeroPeek", "nvidiaOptimize", "amdOptimize")
    networkOptimization = @("disableNagle", "disableThrottling", "optimizeTcp", "disableBandwidthLimit", "optimizeDns", "disableDeliveryOpt", "disableNicPowerSave")
    uiOptimization = @("disableTransparency", "disableAnimations", "disableShadows", "disableSnapAssist", "disableWidgets", "disableCopilot", "disableNotificationCenter", "performanceVisualEffects")
    privacyOptimization = @("telemetryMinimal", "disableAdId", "disableActivityHistory", "disableLocation", "disableDiagViewer", "disableSuggestions", "disableStartSuggestions", "disableCortana")
    securityOptimization = @("defenderExclusions", "optimizeScanSchedule", "optimizeDEP", "reduceMitigations")
}

$Script:CommandItems = @(
    "bootOptimization.bootProcessorsFull",
    "cpuOptimization.disableHPET",
    "gpuOptimization.nvidiaOptimize",
    "gpuOptimization.amdOptimize",
    "securityOptimization.defenderExclusions"
)

$Script:DiagnosticItems = @(
    "storageOptimization.disableSearchIndex",
    "storageOptimization.disableNtfsLog",
    "ssdOptimization.disableDefrag",
    "ssdOptimization.enableWriteCache",
    "ssdOptimization.checkAhci",
    "networkOptimization.optimizeTcp",
    "networkOptimization.disableDeliveryOpt"
)

$Script:EnumTargets = @{
    "taskScheduling.disableBackgroundApps" = @("userControl", "forceAllow", "forceDeny")
    "serviceOptimization.*" = @("automatic", "automaticDelayed", "manual", "disabled")
    "powerManagement.ultimatePerformancePlan" = @("ultimatePerformance", "balanced")
    "powerManagement.disablePcieLpm" = @(0, 1, 2)
    "powerManagement.aggressiveBoost" = @(0, 1, 2, 3, 4)
    "storageOptimization.optimizePagefile" = @("systemManaged", "custom", "disabled")
    "ssdOptimization.disablePrefetch" = @("systemDefault", "enabled", "disabled", "custom")
    "memoryOptimization.disableCrashDump" = @("systemDefault", 0, 1, 2, 3, 7)
    "memoryOptimization.largeSystemCache" = @("desktop", "server")
    "cpuOptimization.optimizeTimer" = @("systemDefault", "platformTick", "custom")
    "gpuOptimization.hwSchedule" = @("systemDefault", "enabled", "disabled", "custom")
    "networkOptimization.optimizeDns" = @("automatic", "cloudflare", "custom")
    "networkOptimization.disableNicPowerSave" = @("enabled", "disabled", "mixed")
    "uiOptimization.performanceVisualEffects" = @("systemDefault", "appearance", "performance", "custom")
    "privacyOptimization.telemetryMinimal" = @("systemDefault", 0, 1, 2, 3)
    "securityOptimization.optimizeDEP" = @("systemDefault", "OptIn", "OptOut", "AlwaysOn", "AlwaysOff")
    "securityOptimization.reduceMitigations" = @("systemDefault", "reduced")
}

$Script:SystemDefaultIntegerTargets = @(
    "windowsUpdate.deferQualityUpdates",
    "windowsUpdate.deferFeatureUpdates",
    "bootOptimization.reduceBootTimeout",
    "taskScheduling.foregroundPriority",
    "gpuOptimization.gpuPriority",
    "networkOptimization.disableBandwidthLimit"
)

$Script:PreserveOnlyTargets = @{
    "storageOptimization.optimizePagefile" = @("custom")
    "ssdOptimization.disablePrefetch" = @("custom")
    "cpuOptimization.optimizeTimer" = @("custom")
    "gpuOptimization.hwSchedule" = @("custom")
    "gpuOptimization.gpuPriority" = @("custom")
    "networkOptimization.optimizeDns" = @("custom")
    "networkOptimization.disableNicPowerSave" = @("mixed")
    "uiOptimization.performanceVisualEffects" = @("custom")
}

$Script:IntegerTargetRanges = @{
    "windowsUpdate.deferQualityUpdates" = @(0, 365)
    "windowsUpdate.deferFeatureUpdates" = @(0, 3650)
    "bootOptimization.reduceBootTimeout" = @(0, 999)
    "taskScheduling.foregroundPriority" = @(0, 63)
    "powerManagement.minProcessorState100" = @(0, 100)
    "powerManagement.disableDiskAutoOff" = @(0, 86400)
    "storageOptimization.disableLastAccess" = @(0, 3)
    "storageOptimization.disableDot3Name" = @(0, 3)
    "cpuOptimization.disableCoreParking" = @(0, 100)
    "gpuOptimization.gpuPriority" = @(0, 31)
    "networkOptimization.disableBandwidthLimit" = @(0, 100)
}

function Test-AdminPrivilege {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-ExactPropertyNames {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Location
    )

    if ($null -eq $Object -or $Object -isnot [PSCustomObject]) { throw "$Location must be an object" }
    $actual = @($Object.PSObject.Properties.Name)
    foreach ($name in $Expected) {
        if ($actual -cnotcontains $name) { throw "$Location.$name is required" }
    }
    foreach ($name in $actual) {
        if ($Expected -cnotcontains $name) { throw "$Location.$name is not allowed" }
    }
}

function Test-JsonIntegerValue {
    param([AllowNull()]$Value)

    if ($null -eq $Value -or $Value -is [bool]) { return $false }
    $typeCode = [Type]::GetTypeCode($Value.GetType())
    if (@(
        [TypeCode]::Byte, [TypeCode]::SByte, [TypeCode]::Int16, [TypeCode]::UInt16,
        [TypeCode]::Int32, [TypeCode]::UInt32, [TypeCode]::Int64, [TypeCode]::UInt64
    ) -contains $typeCode) { return $true }
    if (@([TypeCode]::Decimal, [TypeCode]::Double, [TypeCode]::Single) -notcontains $typeCode) { return $false }

    try {
        $number = [decimal]$Value
        return ([decimal]::Truncate($number) -eq $number)
    } catch {
        return $false
    }
}

function Test-StrictAllowedTarget {
    param(
        [Parameter(Mandatory = $true)][object[]]$AllowedTargets,
        [AllowNull()]$Target
    )

    foreach ($allowed in $AllowedTargets) {
        if ($allowed -is [string]) {
            if ($Target -is [string] -and [string]::Equals($allowed, $Target, [StringComparison]::Ordinal)) { return $true }
            continue
        }
        if (Test-JsonIntegerValue $allowed) {
            if ((Test-JsonIntegerValue $Target) -and [decimal]$allowed -eq [decimal]$Target) { return $true }
            continue
        }
        if ($allowed -is [bool] -and $Target -is [bool] -and $allowed -eq $Target) { return $true }
    }
    return $false
}

function Assert-OptimizationConfig {
    param([Parameter(Mandatory = $true)][PSCustomObject]$Config)

    $allowedRoot = @("version", "preset", "categories", "exportedAt", "hardware")
    foreach ($name in @($Config.PSObject.Properties.Name)) {
        if ($allowedRoot -cnotcontains $name) { throw "$name is not allowed" }
    }
    if ($Config.version -isnot [string] -or $Config.version -cne "2.0") { throw "version must be the string 2.0" }
    if ($Config.preset -isnot [string] -or @("conservative", "balanced", "extreme", "custom") -cnotcontains $Config.preset) { throw "preset is invalid" }
    if ($Config.categories -isnot [PSCustomObject]) { throw "categories must be an object" }

    Assert-ExactPropertyNames -Object $Config.categories -Expected @($Script:ConfigItems.Keys) -Location "categories"
    foreach ($categoryName in $Script:ConfigItems.Keys) {
        $category = $Config.categories.$categoryName
        Assert-ExactPropertyNames -Object $category -Expected @("items") -Location "categories.$categoryName"
        Assert-ExactPropertyNames -Object $category.items -Expected @($Script:ConfigItems[$categoryName]) -Location "categories.$categoryName.items"

        foreach ($itemName in $Script:ConfigItems[$categoryName]) {
            $item = $category.items.$itemName
            $location = "categories.$categoryName.items.$itemName"
            $qualifiedName = "$categoryName.$itemName"
            if ($Script:CommandItems -contains $qualifiedName) {
                Assert-ExactPropertyNames -Object $item -Expected @("execute") -Location $location
                if ($item.execute -isnot [bool]) { throw "$location.execute must be a boolean" }
                continue
            }
            if ($Script:DiagnosticItems -contains $qualifiedName) {
                Assert-ExactPropertyNames -Object $item -Expected @("diagnostic") -Location $location
                if ($item.diagnostic -ne $true) { throw "$location.diagnostic must be true" }
                continue
            }

            Assert-ExactPropertyNames -Object $item -Expected @("target") -Location $location
            $target = $item.target
            $range = $Script:IntegerTargetRanges[$qualifiedName]
            if ($range) {
                if (Test-OptimizationTargetPreserveOnly -Category $categoryName -ItemName $itemName -Target $target) { continue }
                if ($target -eq "systemDefault") {
                    if ($Script:SystemDefaultIntegerTargets -notcontains $qualifiedName) {
                        throw "$location.target does not support systemDefault"
                    }
                    continue
                }
                if (-not (Test-JsonIntegerValue $target)) { throw "$location.target must be an integer or systemDefault" }
                if ([decimal]$target -lt $range[0] -or [decimal]$target -gt $range[1]) { throw "$location.target is outside the allowed range" }
                continue
            }

            $allowedTargets = if ($categoryName -eq "serviceOptimization") {
                $Script:EnumTargets["serviceOptimization.*"]
            } else {
                $Script:EnumTargets[$qualifiedName]
            }
            if ($allowedTargets) {
                if ($qualifiedName -eq "powerManagement.ultimatePerformancePlan" -and
                    $target -is [string] -and $target -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { continue }
                if (-not (Test-StrictAllowedTarget -AllowedTargets @($allowedTargets) -Target $target)) { throw "$location.target is invalid" }
                continue
            }
            if ($target -isnot [bool]) {
                throw "$location.target must be a boolean"
            }
        }
    }
}

function Read-OptimizationConfig {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)

    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw "Config file not found: $ConfigPath" }
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    Assert-OptimizationConfig -Config $config
    return $config
}

function Get-ConfigItemTarget {
    param(
        [Parameter(Mandatory = $true)][PSCustomObject]$Config,
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$ItemName
    )

    $cat = $Config.categories.PSObject.Properties[$Category]
    if ($null -eq $cat) { throw "Unknown config category: $Category" }
    $item = $cat.Value.items.PSObject.Properties[$ItemName]
    if ($null -eq $item -or $item.Value -isnot [PSCustomObject] -or
        $null -eq $item.Value.PSObject.Properties["target"]) {
        throw "Config item does not define a target: $Category.$ItemName"
    }
    return $item.Value.target
}

function Test-ConfigItemCommand {
    param(
        [Parameter(Mandatory = $true)][PSCustomObject]$Config,
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$ItemName
    )

    $cat = $Config.categories.PSObject.Properties[$Category]
    if ($null -eq $cat) { throw "Unknown config category: $Category" }
    $item = $cat.Value.items.PSObject.Properties[$ItemName]
    if ($null -eq $item -or $item.Value -isnot [PSCustomObject] -or
        $null -eq $item.Value.PSObject.Properties["execute"]) { return $false }
    return ($item.Value.execute -eq $true)
}

function Test-OptimizationItemPlanned {
    param(
        [string[]]$Items,
        [Parameter(Mandatory = $true)][string]$ItemName
    )

    return ($null -eq $Items -or $Items -contains $ItemName)
}

function Test-OptimizationTargetPreserveOnly {
    param(
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$ItemName,
        [Parameter(Mandatory = $true)]$Target
    )

    if (
        $Category -eq "powerManagement" -and
        $ItemName -eq "ultimatePerformancePlan" -and
        $Target -is [string] -and
        $Target -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ) { return $true }

    $values = $Script:PreserveOnlyTargets["$Category.$ItemName"]
    return ($null -ne $values -and $values -contains $Target)
}

function Complete-TrackedOperation {
    param(
        [Parameter(Mandatory = $true)][string]$ChangeId,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    try { & $Action }
    catch {
        $actionError = $_.Exception.Message
        try { Set-OptimizationChangeResult -Id $ChangeId -Status "Failed" -ErrorMessage $actionError }
        catch { throw "System change failed and its journal status could not be saved: $actionError; journal: $($_.Exception.Message)" }
        throw $actionError
    }
    try { Set-OptimizationChangeResult -Id $ChangeId -Status "Applied" }
    catch { throw "System change succeeded, but its journal status could not be saved; no further changes are safe: $($_.Exception.Message)" }
}

function Get-BcdElementSnapshot {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("{current}", "{bootmgr}")][string]$Identifier,
        [Parameter(Mandatory = $true)][string]$Element
    )

    $result = Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/enum", $Identifier)
    foreach ($line in @($result.Output)) {
        if ($line.ToString() -match "^\s*$([regex]::Escape($Element))\s+(.+?)\s*$") {
            return [PSCustomObject]@{ Exists = $true; Value = $Matches[1] }
        }
    }
    return [PSCustomObject]@{ Exists = $false; Value = $null }
}

function Set-TrackedBcdElement {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("{current}", "{bootmgr}")][string]$Identifier,
        [Parameter(Mandatory = $true)][string]$Element,
        [Parameter(Mandatory = $true)][string]$Value,
        [string]$Description = ""
    )

    $original = Get-BcdElementSnapshot -Identifier $Identifier -Element $Element
    if ($original.Exists -and [string]$original.Value -ieq $Value) { return $false }
    $changeId = Register-OptimizationChange -Kind "BcdElement" -Target $Element -OriginalValue $original.Value -NewValue $Value -OriginalExists $original.Exists -Description $Description -Metadata @{ Identifier = $Identifier }
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/set", $Identifier, $Element, $Value) | Out-Null
        $updated = Get-BcdElementSnapshot -Identifier $Identifier -Element $Element
        if (-not $updated.Exists -or -not [string]::Equals([string]$updated.Value, $Value, [StringComparison]::OrdinalIgnoreCase)) {
            throw "BCD element verification failed after write: $Identifier $Element"
        }
    }
    return $true
}

function Remove-TrackedBcdElement {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("{current}", "{bootmgr}")][string]$Identifier,
        [Parameter(Mandatory = $true)][string]$Element,
        [string]$Description = ""
    )

    $original = Get-BcdElementSnapshot -Identifier $Identifier -Element $Element
    if (-not $original.Exists) { return $false }
    $changeId = Register-OptimizationChange -Kind "BcdElement" -Target $Element -OriginalValue $original.Value -NewValue $null -OriginalExists $true -Description $Description -Metadata @{ Identifier = $Identifier }
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/deletevalue", $Identifier, $Element) | Out-Null
        if ((Get-BcdElementSnapshot -Identifier $Identifier -Element $Element).Exists) {
            throw "BCD element verification failed after delete: $Identifier $Element"
        }
    }
    return $true
}

function Get-ActivePowerSchemeGuid {
    $result = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
    $guid = Get-GuidFromText -InputObject $result.Output
    if (-not $guid) { throw "Unable to determine the active power scheme" }
    return $guid
}

function Get-PowerSettingSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$SchemeGuid,
        [Parameter(Mandatory = $true)][string]$Subgroup,
        [Parameter(Mandatory = $true)][string]$Setting
    )

    $result = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/query", $SchemeGuid, $Subgroup, $Setting)
    $text = (@($result.Output) | ForEach-Object { $_.ToString() }) -join "`n"
    $matches = [regex]::Matches($text, '(?i)0x([0-9a-f]{8})')
    if ($matches.Count -lt 2) { throw "Unable to read power setting $Setting" }
    return [PSCustomObject]@{
        AC = [Convert]::ToUInt32($matches[$matches.Count - 2].Groups[1].Value, 16)
        DC = [Convert]::ToUInt32($matches[$matches.Count - 1].Groups[1].Value, 16)
    }
}

function Set-TrackedPowerSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Subgroup,
        [Parameter(Mandatory = $true)][string]$Setting,
        [Parameter(Mandatory = $true)][uint32]$Value,
        [switch]$IncludeDc,
        [string]$Description = ""
    )

    $schemeGuid = Get-ActivePowerSchemeGuid
    $original = Get-PowerSettingSnapshot -SchemeGuid $schemeGuid -Subgroup $Subgroup -Setting $Setting
    if ($original.AC -eq $Value -and (-not $IncludeDc -or $original.DC -eq $Value)) { return $false }
    $newValue = [PSCustomObject]@{ AC = $Value; DC = if ($IncludeDc) { $Value } else { $original.DC } }
    $metadata = @{ SchemeGuid = $schemeGuid; SubgroupGuid = $Subgroup; SettingGuid = $Setting }
    $changeId = Register-OptimizationChange -Kind "PowerSetting" -Target "$schemeGuid|$Setting" -OriginalValue $original -NewValue $newValue -Description $Description -Metadata $metadata
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setacvalueindex", $schemeGuid, $Subgroup, $Setting, [string]$Value) | Out-Null
        if ($IncludeDc) {
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setdcvalueindex", $schemeGuid, $Subgroup, $Setting, [string]$Value) | Out-Null
        }
        Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setactive", $schemeGuid) | Out-Null
        $updated = Get-PowerSettingSnapshot -SchemeGuid $schemeGuid -Subgroup $Subgroup -Setting $Setting
        if ($updated.AC -ne $Value -or ($IncludeDc -and $updated.DC -ne $Value)) {
            throw "Power setting verification failed after write: $Setting"
        }
    }
    return $true
}

function Set-TrackedFsutilBehavior {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("disablelastaccess", "disable8dot3", "DisableDeleteNotify")][string]$Behavior,
        [Parameter(Mandatory = $true)][int]$Value,
        [ValidateSet("NTFS", "ReFS")][string]$FileSystem,
        [string]$Description = ""
    )

    if ($FileSystem -and $Behavior -ine "DisableDeleteNotify") {
        throw "A file-system qualifier is only supported for DisableDeleteNotify"
    }

    $queryArguments = @("behavior", "query", $Behavior)
    $setArguments = @("behavior", "set", $Behavior)
    $target = $Behavior
    $metadata = $null
    if ($FileSystem) {
        $queryArguments += $FileSystem
        $setArguments += $FileSystem
        $target = "${Behavior}:$FileSystem"
        $metadata = @{ FileSystem = $FileSystem }
    }

    $result = Invoke-CheckedNativeCommand -FilePath "fsutil.exe" -ArgumentList $queryArguments
    $text = (@($result.Output) | ForEach-Object { $_.ToString() }) -join "`n"
    if ($text -notmatch '=\s*(\d+)') { throw "Unable to read fsutil behavior $Behavior" }
    $original = [int]$Matches[1]
    if ($original -eq $Value) { return $false }
    $changeId = Register-OptimizationChange -Kind "FsutilBehavior" -Target $target -OriginalValue $original -NewValue $Value -Description $Description -Metadata $metadata
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "fsutil.exe" -ArgumentList @($setArguments + [string]$Value) | Out-Null
        $updatedResult = Invoke-CheckedNativeCommand -FilePath "fsutil.exe" -ArgumentList $queryArguments
        $updatedText = (@($updatedResult.Output) | ForEach-Object { $_.ToString() }) -join "`n"
        if ($updatedText -notmatch '=\s*(\d+)' -or [int]$Matches[1] -ne $Value) {
            throw "Fsutil behavior verification failed after write: $target"
        }
    }
    return $true
}

function Set-TrackedHibernation {
    param([Parameter(Mandatory = $true)][bool]$Enabled, [string]$Description = "")

    $value = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "HibernateEnabled" -ErrorAction Stop
    $original = ([int]$value.HibernateEnabled -ne 0)
    if ($original -eq $Enabled) { return $false }
    $changeId = Register-OptimizationChange -Kind "Hibernation" -Target "System" -OriginalValue $original -NewValue $Enabled -Description $Description
    $mode = if ($Enabled) { "on" } else { "off" }
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/hibernate", $mode) | Out-Null
        $updated = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "HibernateEnabled" -ErrorAction Stop
        if (([int]$updated.HibernateEnabled -ne 0) -ne $Enabled) {
            throw "Hibernation verification failed after write"
        }
    }
    return $true
}

Export-ModuleMember -Function Test-AdminPrivilege, Assert-OptimizationConfig, Read-OptimizationConfig, Get-ConfigItemTarget, Test-ConfigItemCommand, Test-OptimizationItemPlanned, Test-OptimizationTargetPreserveOnly, Complete-TrackedOperation, Get-BcdElementSnapshot, Set-TrackedBcdElement, Remove-TrackedBcdElement, Get-ActivePowerSchemeGuid, Get-PowerSettingSnapshot, Set-TrackedPowerSetting, Set-TrackedFsutilBehavior, Set-TrackedHibernation
