#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [switch]$DryRun,
    [switch]$AutoConfirm,
    [string]$LogDir
)

$ErrorActionPreference = "Stop"
if (-not $LogDir) { $LogDir = Join-Path $PSScriptRoot ".." }
$LogDir = [IO.Path]::GetFullPath($LogDir)
$utilsPath = Join-Path $PSScriptRoot "utils"
$modulesPath = Join-Path $PSScriptRoot "modules"

try {
    Import-Module (Join-Path $utilsPath "NativeCommand.psm1") -Force
    Import-Module (Join-Path $utilsPath "ChangeTracking.psm1") -Force
    Import-Module (Join-Path $utilsPath "Logging.psm1") -Force
    Import-Module (Join-Path $utilsPath "Registry.psm1") -Force
    Import-Module (Join-Path $utilsPath "Service.psm1") -Force
    Import-Module (Join-Path $utilsPath "HardwareDetect.psm1") -Force
    Import-Module (Join-Path $utilsPath "RestorePoint.psm1") -Force
    Import-Module (Join-Path $utilsPath "Backup.psm1") -Force
    Import-Module (Join-Path $modulesPath "Common.psm1") -Force
    Import-Module (Join-Path $modulesPath "SystemStatus.psm1") -Force

    $optimizationModules = @(
        "WindowsUpdate","BootOptimization","TaskScheduling","ServiceOptimization",
        "PowerManagement","StorageOptimization","SSDOptimization","MemoryOptimization",
        "CPUOptimization","GPUOptimization","NetworkOptimization","UIOptimization",
        "PrivacyOptimization","SecurityOptimization"
    )
    foreach ($moduleName in $optimizationModules) {
        Import-Module (Join-Path $modulesPath "$moduleName.psm1") -Force -ErrorAction Stop
    }

    # Nested modules force-import utilities into private session states. Re-publish
    # the orchestrator's utility commands after all optimization modules load.
    Import-Module (Join-Path $utilsPath "NativeCommand.psm1") -Force
    Import-Module (Join-Path $utilsPath "ChangeTracking.psm1") -Force
    Import-Module (Join-Path $utilsPath "Logging.psm1") -Force
    Import-Module (Join-Path $utilsPath "Registry.psm1") -Force
    Import-Module (Join-Path $utilsPath "Service.psm1") -Force
    Import-Module (Join-Path $utilsPath "HardwareDetect.psm1") -Force
    Import-Module (Join-Path $utilsPath "RestorePoint.psm1") -Force
    Import-Module (Join-Path $utilsPath "Backup.psm1") -Force
} catch {
    Write-Error "PowerShell module initialization failed: $($_.Exception.Message)"
    exit 1
}

try {
    Initialize-Log -LogDirectory $LogDir
} catch {
    Write-Error "Log initialization failed: $($_.Exception.Message)"
    exit 1
}

Write-LogSection "Windows 11 Gaming Optimizer"
try {
    $resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
    $config = Read-OptimizationConfig -ConfigPath $resolvedConfigPath
    Write-LogEntry "Config: $resolvedConfigPath | Preset: $($config.preset)"
} catch {
    Write-LogEntry "Config error: $($_.Exception.Message)" -Level "ERROR"
    exit 1
}

$mutationLock = $null
try {
    if (-not $DryRun) {
        try {
            $mutationLock = Enter-OptimizerMutationLock
        } catch {
            Write-LogEntry "Optimization cannot start: $($_.Exception.Message)" -Level "ERROR"
            exit 3
        }
    }

Write-LogSection "Hardware Detection"
$hardwareInfo = $null
try {
    $hardwareInfo = Get-HardwareInfo
    Write-LogEntry (Format-HardwareSummary -HardwareInfo $hardwareInfo)
} catch {
    Write-LogEntry "Hardware detection failed: $($_.Exception.Message)" -Level "WARN"
}

$categories = @(
    @{Name="Windows Update";Key="windowsUpdate"},@{Name="Boot";Key="bootOptimization"},
    @{Name="Task Scheduling";Key="taskScheduling"},@{Name="Services";Key="serviceOptimization"},
    @{Name="Power";Key="powerManagement"},@{Name="Storage";Key="storageOptimization"},
    @{Name="SSD";Key="ssdOptimization"},@{Name="Memory";Key="memoryOptimization"},
    @{Name="CPU";Key="cpuOptimization"},@{Name="GPU";Key="gpuOptimization"},
    @{Name="Network";Key="networkOptimization"},@{Name="UI";Key="uiOptimization"},
    @{Name="Privacy";Key="privacyOptimization"},@{Name="Security";Key="securityOptimization"}
)

function Get-ObjectMemberValue {
    param($InputObject, [Parameter(Mandatory = $true)][string]$Name)

    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) { return $InputObject[$Name] }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-PlanValuesEqual {
    param($CurrentValue, $TargetValue)

    if ($null -eq $CurrentValue -or $null -eq $TargetValue) { return $false }
    if ($CurrentValue -is [bool] -or $TargetValue -is [bool]) {
        return ($CurrentValue -is [bool] -and $TargetValue -is [bool] -and $CurrentValue -eq $TargetValue)
    }
    $currentType = $CurrentValue.GetType()
    $targetType = $TargetValue.GetType()
    if ($currentType.IsPrimitive -and $targetType.IsPrimitive) {
        try { return ([decimal]$CurrentValue -eq [decimal]$TargetValue) } catch { return $false }
    }
    return [string]::Equals([string]$CurrentValue, [string]$TargetValue, [StringComparison]::OrdinalIgnoreCase)
}

function Format-PlanValue {
    param($Value)

    if ($null -eq $Value) { return "<unknown>" }
    if ($Value -is [bool]) { return $Value.ToString().ToLowerInvariant() }
    if ($Value -is [string]) { return '"' + $Value + '"' }
    return [string]$Value
}

function New-OptimizationExecutionPlan {
    param(
        [Parameter(Mandatory = $true)][PSCustomObject]$Config,
        [Parameter(Mandatory = $true)]$SystemStatus,
        [Parameter(Mandatory = $true)][object[]]$CategoryDefinitions,
        [AllowNull()]$HardwareInfo
    )

    $plan = [System.Collections.ArrayList]::new()
    $hibernationTarget = $Config.categories.storageOptimization.items.disableHibernation.target
    foreach ($category in $CategoryDefinitions) {
        $categoryConfig = Get-ObjectMemberValue (Get-ObjectMemberValue $Config "categories") $category.Key
        $categoryStatus = Get-ObjectMemberValue $SystemStatus $category.Key
        $items = Get-ObjectMemberValue $categoryConfig "items"
        foreach ($itemProperty in @($items.PSObject.Properties)) {
            $itemConfig = $itemProperty.Value
            $itemStatus = Get-ObjectMemberValue $categoryStatus $itemProperty.Name
            $available = [bool](Get-ObjectMemberValue $itemStatus "available")
            $applicableValue = Get-ObjectMemberValue $itemStatus "applicable"
            $applicable = if ($null -eq $applicableValue) { $true } else { [bool]$applicableValue }
            $stateConsistentValue = Get-ObjectMemberValue $itemStatus "stateConsistent"
            $stateConsistent = if ($null -eq $stateConsistentValue) { $true } else { [bool]$stateConsistentValue }
            $currentValue = Get-ObjectMemberValue $itemStatus "currentValue"
            $blockedReason = [string](Get-ObjectMemberValue $itemStatus "blockedReason")
            $blockedTargetsValue = Get-ObjectMemberValue $itemStatus "blockedTargets"
            $kind = "target"
            $targetValue = $null
            $shouldApply = $false
            $blocksExecution = $false
            $action = "No change"

            if ($null -ne $itemConfig.PSObject.Properties["diagnostic"]) {
                $kind = "diagnostic"
            } elseif ($null -ne $itemConfig.PSObject.Properties["execute"]) {
                $kind = "command"
                $targetValue = [bool]$itemConfig.execute
            }

            if (-not $applicable) {
                $action = "Not applicable"
            } elseif ($null -ne $itemConfig.PSObject.Properties["diagnostic"]) {
                $kind = "diagnostic"
                $action = "Diagnostic only"
            } elseif ($null -ne $itemConfig.PSObject.Properties["execute"]) {
                $kind = "command"
                $targetValue = [bool]$itemConfig.execute
                if (-not $targetValue) {
                    $action = "Not selected"
                } elseif (-not $available) {
                    $action = "Blocked: command availability is unknown"
                    $blocksExecution = $true
                } elseif ($blockedReason) {
                    $action = "Blocked: $blockedReason"
                    $blocksExecution = $true
                } else {
                    $action = "Execute once"
                    $shouldApply = $true
                }
            } else {
                $targetValue = $itemConfig.target
                if (-not $available -or $null -eq $currentValue) {
                    $action = "Blocked: current state is unknown"
                    $blocksExecution = $true
                } elseif (
                    $category.Key -eq "bootOptimization" -and
                    $itemProperty.Name -eq "fastStartup" -and
                    $targetValue -eq $true -and
                    $hibernationTarget -eq $false
                ) {
                    $action = "Blocked: fast startup requires hibernation to remain enabled"
                    $blocksExecution = $true
                } elseif ((Test-PlanValuesEqual $currentValue $targetValue) -and $stateConsistent) {
                    $action = "No change"
                } elseif (
                    $category.Key -eq "memoryOptimization" -and
                    $itemProperty.Name -eq "disableMemoryCompression" -and
                    $targetValue -eq $false -and
                    ($null -eq $HardwareInfo -or [double](Get-ObjectMemberValue $HardwareInfo "RAMGB") -lt 16)
                ) {
                    $action = "Blocked: disabling memory compression requires at least 16 GB of detected RAM"
                    $blocksExecution = $true
                } elseif (Test-OptimizationTargetPreserveOnly -Category $category.Key -ItemName $itemProperty.Name -Target $targetValue) {
                    $action = "Blocked: this target can only preserve the matching current state"
                    $blocksExecution = $true
                } elseif ($blockedReason -and (
                    $null -eq $blockedTargetsValue -or
                    @($blockedTargetsValue | Where-Object { Test-PlanValuesEqual $_ $targetValue }).Count -gt 0
                )) {
                    $action = "Blocked: $blockedReason"
                    $blocksExecution = $true
                } else {
                    $action = if (-not $stateConsistent -and (Test-PlanValuesEqual $currentValue $targetValue)) {
                        "Repair inconsistent state for target $(Format-PlanValue $targetValue)"
                    } else {
                        "Set $(Format-PlanValue $currentValue) -> $(Format-PlanValue $targetValue)"
                    }
                    $shouldApply = $true
                }
            }

            $null = $plan.Add([PSCustomObject]@{
                Category = $category.Key
                CategoryName = $category.Name
                Item = $itemProperty.Name
                Kind = $kind
                CurrentValue = $currentValue
                TargetValue = $targetValue
                Action = $action
                ShouldApply = $shouldApply
                BlocksExecution = $blocksExecution
                Applicable = $applicable
                StateConsistent = $stateConsistent
            })
        }
    }
    return @($plan.ToArray())
}

function Update-ExecutionPlanDependencies {
    param([Parameter(Mandatory = $true)][object[]]$Plan)

    $powerPlanItem = $Plan | Where-Object { $_.Category -eq "powerManagement" -and $_.Item -eq "ultimatePerformancePlan" } | Select-Object -First 1
    if ($powerPlanItem -and $powerPlanItem.ShouldApply) {
        $powerPlanDependencies = @(
            @{ Category = "powerManagement"; Item = "minProcessorState100" },
            @{ Category = "powerManagement"; Item = "disableUsbSuspend" },
            @{ Category = "powerManagement"; Item = "disablePcieLpm" },
            @{ Category = "powerManagement"; Item = "disableDiskAutoOff" },
            @{ Category = "powerManagement"; Item = "aggressiveBoost" },
            @{ Category = "cpuOptimization"; Item = "disableCoreParking" }
        )
        foreach ($dependency in $powerPlanDependencies) {
            $item = $Plan | Where-Object { $_.Category -eq $dependency.Category -and $_.Item -eq $dependency.Item } | Select-Object -First 1
            if (-not $item -or -not $item.Applicable -or $item.BlocksExecution -or $item.Kind -ne "target" -or $item.ShouldApply) { continue }
            $item.ShouldApply = $true
            $item.Action = "Reapply target after active power plan changes"
        }
    }

    $hibernationItem = $Plan | Where-Object { $_.Category -eq "storageOptimization" -and $_.Item -eq "disableHibernation" } | Select-Object -First 1
    if ($hibernationItem -and $hibernationItem.ShouldApply) {
        $fastStartupItem = $Plan | Where-Object { $_.Category -eq "bootOptimization" -and $_.Item -eq "fastStartup" } | Select-Object -First 1
        if ($fastStartupItem -and $fastStartupItem.Applicable -and -not $fastStartupItem.BlocksExecution -and $fastStartupItem.Kind -eq "target" -and -not $fastStartupItem.ShouldApply) {
            $fastStartupItem.ShouldApply = $true
            $fastStartupItem.Action = "Reapply target before hibernation support changes"
        }
    }
}

Write-LogSection "Execution Plan"
try {
    $systemStatus = Get-SystemStatus
    $executionPlan = @(New-OptimizationExecutionPlan -Config $config -SystemStatus $systemStatus -CategoryDefinitions $categories -HardwareInfo $hardwareInfo)
    Update-ExecutionPlanDependencies -Plan $executionPlan
} catch {
    Write-LogEntry "System status detection failed: $($_.Exception.Message)" -Level "ERROR"
    exit 1
}

$plannedItems = @($executionPlan | Where-Object { $_.ShouldApply })
$blockedItems = @($executionPlan | Where-Object { $_.BlocksExecution })
$diagnosticItems = @($executionPlan | Where-Object { $_.Kind -eq "diagnostic" })
foreach ($category in $categories) {
    $categoryCount = @($plannedItems | Where-Object { $_.Category -eq $category.Key }).Count
    if ($categoryCount -gt 0) { Write-LogEntry "  $($category.Name): $categoryCount planned changes" }
}
Write-LogEntry "Total: $($plannedItems.Count) planned | $($blockedItems.Count) blocked | $($diagnosticItems.Count) diagnostic"

if ($DryRun) {
    foreach ($item in $executionPlan) {
        $current = Format-PlanValue $item.CurrentValue
        $target = if ($item.Kind -eq "diagnostic") { "<read-only>" } else { Format-PlanValue $item.TargetValue }
        Write-LogEntry "[DRY RUN] $($item.Category).$($item.Item) | current=$current | target=$target | action=$($item.Action)"
    }
    Write-LogEntry "[DRY RUN] No changes will be made" -Level "WARN"
    if ($blockedItems.Count -gt 0) {
        Write-LogEntry "[DRY RUN] BLOCKED: one or more requested target states cannot be verified; optimization would not start" -Level "ERROR"
        exit 2
    }
    Write-LogEntry "[DRY RUN] READY: all requested target states are verifiable" -Level "SUCCESS"
    exit 0
}

if ($blockedItems.Count -gt 0) {
    foreach ($item in $blockedItems) {
        Write-LogEntry "Cannot execute $($item.Category).$($item.Item): $($item.Action)" -Level "ERROR"
    }
    Write-LogEntry "Optimization was not started because one or more target states cannot be verified" -Level "ERROR"
    exit 1
}

if ($plannedItems.Count -eq 0) {
    Write-LogEntry "All detectable targets already match the requested configuration"
    exit 0
}

if (-not (Test-ProcessAdministrator)) {
    Write-LogEntry "Administrator privileges are required to apply optimizations" -Level "ERROR"
    exit 1
}

if (-not $AutoConfirm) {
    Write-Host "`nProceed with optimization? Type YES to continue." -ForegroundColor Yellow
    if ((Read-Host) -ne "YES") {
        Write-LogEntry "Cancelled by user"
        exit 0
    }
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$changesDirectory = if ([string]::IsNullOrWhiteSpace($env:WIN11OPTIMIZER_DATA_DIR)) {
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\config\output"))
} else {
    [IO.Path]::GetFullPath($env:WIN11OPTIMIZER_DATA_DIR)
}
$changesFile = Join-Path $changesDirectory "changes_$timestamp.json"
if (Test-Path -LiteralPath $changesFile) {
    $changesFile = Join-Path $changesDirectory "changes_$timestamp`_$([guid]::NewGuid().ToString('N').Substring(0, 8)).json"
}
try {
    Initialize-OptimizationChangeTracker -JournalPath $changesFile | Out-Null
} catch {
    Write-LogEntry "Could not initialize the durable change journal: $($_.Exception.Message)" -Level "ERROR"
    exit 1
}

Write-LogSection "Creating Pre-Apply Backup"
try {
    $backupResult = New-OptimizationBackup -OutputDirectory $changesDirectory -RestorePointDescription "Win11Opt-PreApply-$timestamp"
    foreach ($warning in @($backupResult.Warnings)) { Write-LogEntry $warning -Level "WARN" }
    if (-not $backupResult.Success) {
        foreach ($backupError in @($backupResult.Errors)) {
            Add-OptimizationSessionError -Source "Backup" -Message $backupError
            Write-LogEntry $backupError -Level "ERROR"
        }
        Set-OptimizationChangeSession -Status BackupFailed -BackupPath $backupResult.BackupDirectory
        Write-LogEntry "Optimization was not started because the pre-apply backup was incomplete" -Level "ERROR"
        exit 1
    }

    Set-OptimizationChangeSession -Status Ready -BackupPath $backupResult.BackupDirectory `
        -RestorePointSequenceNumber $backupResult.RestorePointSequenceNumber `
        -RestorePointDescription $backupResult.RestorePointDescription
    Write-LogEntry "Backup: $($backupResult.BackupDirectory)"
    if ($backupResult.RestorePointSequenceNumber) {
        Write-LogEntry "Restore point: $($backupResult.RestorePointDescription) (sequence $($backupResult.RestorePointSequenceNumber))"
    } else {
        Write-LogEntry "No new Win11Optimizer system restore point was recorded; the file backup and change journal remain available for rollback" -Level "WARN"
    }
} catch {
    Add-OptimizationSessionError -Source "Backup" -Message $_.Exception.Message
    Set-OptimizationChangeSession -Status BackupFailed
    Write-LogEntry "Pre-apply backup failed: $($_.Exception.Message)" -Level "ERROR"
    exit 1
}

$moduleMap = @{
    "windowsUpdate"="Invoke-WindowsUpdateOptimization";"bootOptimization"="Invoke-BootOptimization"
    "taskScheduling"="Invoke-TaskSchedulingOptimization";"serviceOptimization"="Invoke-ServiceOptimization"
    "powerManagement"="Invoke-PowerManagementOptimization";"storageOptimization"="Invoke-StorageOptimization"
    "ssdOptimization"="Invoke-SSDOptimization";"memoryOptimization"="Invoke-MemoryOptimization"
    "cpuOptimization"="Invoke-CPUOptimization";"gpuOptimization"="Invoke-GPUOptimization"
    "networkOptimization"="Invoke-NetworkOptimization";"uiOptimization"="Invoke-UIOptimization"
    "privacyOptimization"="Invoke-PrivacyOptimization";"securityOptimization"="Invoke-SecurityOptimization"
}

$failures = [System.Collections.ArrayList]::new()
$plannedCategories = @($plannedItems | ForEach-Object { $_.Category } | Select-Object -Unique)
Set-OptimizationChangeSession -Status Applying
foreach ($category in $categories) {
    $categoryProperty = $config.categories.PSObject.Properties | Where-Object { $_.Name -eq $category.Key }
    if (-not $categoryProperty -or $plannedCategories -notcontains $category.Key) { continue }

    $functionName = $moduleMap[$category.Key]
    $command = Get-Command $functionName -ErrorAction SilentlyContinue
    if (-not $command) {
        $message = "Optimization function was not found: $functionName"
        $failures.Add($message) | Out-Null
        Add-OptimizationSessionError -Source $category.Key -Message $message
        continue
    }

    try {
        $global:LASTEXITCODE = 0
        $plannedItemNames = @($plannedItems | Where-Object { $_.Category -eq $category.Key } | ForEach-Object { $_.Item })
        $null = & $functionName -Config $config -Items $plannedItemNames
        if ($LASTEXITCODE -ne 0) { throw "A native command returned exit code $LASTEXITCODE" }
    } catch {
        $message = "Module failed ($($category.Key)): $($_.Exception.Message)"
        $failures.Add($message) | Out-Null
        if (Test-OptimizationChangeJournalHealthy) {
            Add-OptimizationSessionError -Source $category.Key -Message $_.Exception.Message
        }
        Write-LogEntry $message -Level "ERROR"
        if (-not (Test-OptimizationChangeJournalHealthy)) {
            Write-LogEntry "Optimization stopped because the durable change journal is no longer writable; no later categories were executed" -Level "ERROR"
            break
        }
    }
}

if (-not (Test-OptimizationChangeJournalHealthy)) {
    Write-LogEntry "The session may contain a Pending record for a system change that already occurred. Use the preserved journal for recovery." -Level "ERROR"
    exit 1
}

$verificationItems = @($executionPlan | Where-Object { $_.Kind -eq "target" -and $_.Applicable -and -not $_.BlocksExecution })
if ($verificationItems.Count -gt 0) {
    Write-LogSection "Verifying Applied Targets"
    try {
        $verificationStatus = Get-SystemStatus
        $verifiedCount = 0
        foreach ($item in $verificationItems) {
            $itemStatus = Get-ObjectMemberValue (Get-ObjectMemberValue $verificationStatus $item.Category) $item.Item
            $available = [bool](Get-ObjectMemberValue $itemStatus "available")
            $stateConsistentValue = Get-ObjectMemberValue $itemStatus "stateConsistent"
            $stateConsistent = if ($null -eq $stateConsistentValue) { $true } else { [bool]$stateConsistentValue }
            $actualValue = Get-ObjectMemberValue $itemStatus "currentValue"
            if (-not $available -or -not $stateConsistent -or $null -eq $actualValue -or -not (Test-PlanValuesEqual $actualValue $item.TargetValue)) {
                $message = "Target verification failed ($($item.Category).$($item.Item)): expected $(Format-PlanValue $item.TargetValue), actual $(Format-PlanValue $actualValue)"
                $failures.Add($message) | Out-Null
                Add-OptimizationSessionError -Source "Verification" -Message $message
                Write-LogEntry $message -Level "ERROR"
                continue
            }
            $verifiedCount++
        }
        Write-LogEntry "Verified $verifiedCount of $($verificationItems.Count) state targets"
    } catch {
        $message = "Post-apply system status verification failed: $($_.Exception.Message)"
        $failures.Add($message) | Out-Null
        Add-OptimizationSessionError -Source "Verification" -Message $message
        Write-LogEntry $message -Level "ERROR"
    }
}

Write-LogSection "Saving Change Log"
try {
    Save-OptimizationChangeJournal | Out-Null
    $manifest = Get-OptimizationChangeManifest
    Write-LogEntry "Change log: $changesFile ($($manifest.ChangeCount) tracked changes)"
} catch {
    Write-LogEntry "Change journal finalization failed: $($_.Exception.Message)" -Level "ERROR"
    exit 1
}

$sessionErrors = @((Get-OptimizationChangeManifest).Errors)
if ($failures.Count -gt 0 -or $sessionErrors.Count -gt 0) {
    Set-OptimizationChangeSession -Status PartiallyFailed
    Write-LogSection "Optimization Partially Failed"
    Write-LogEntry "One or more optimizations failed. Use the recorded change log to roll back this session." -Level "ERROR"
    Write-Host "`nOptimization completed with errors." -ForegroundColor Red
    Write-Host "Change log: $changesFile" -ForegroundColor Cyan
    exit 1
}

Set-OptimizationChangeSession -Status Completed
Write-LogSection "Optimization Complete"
Write-LogEntry "All requested optimizations were applied. Restart recommended."
Write-Host "`nOptimization complete! Restart recommended." -ForegroundColor Green
Write-Host "Change log: $changesFile" -ForegroundColor Cyan
Write-Host "Restore: .\restore.ps1 -ChangesJsonPath `"$changesFile`"" -ForegroundColor Cyan
exit 0
} finally {
    if ($mutationLock) { Exit-OptimizerMutationLock -Lock $mutationLock }
}
