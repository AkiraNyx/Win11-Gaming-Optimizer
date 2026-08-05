#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Enable-TrackedUltimatePerformancePlan {
    $templateGuid = "e9a42b02-d5df-448d-aa00-03f14749eb61"
    $planName = "Win11 Gaming Ultimate Performance"
    $activeGuid = Get-ActivePowerSchemeGuid

    $listResult = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/list")
    $targetGuid = $null
    foreach ($line in @($listResult.Output)) {
        if ($line.ToString() -like "*$planName*") {
            $targetGuid = Get-GuidFromText -InputObject $line
            if ($targetGuid) { break }
        }
    }

    if (-not $targetGuid) {
        $targetGuid = [guid]::NewGuid().ToString()
        $createId = Register-OptimizationChange -Kind "PowerSchemeCreated" -Target $targetGuid -OriginalValue $null -NewValue $planName -OriginalExists $false -Description "Create optimizer power scheme"
        Complete-TrackedOperation -ChangeId $createId -Action {
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/duplicatescheme", $templateGuid, $targetGuid) | Out-Null
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/changename", $targetGuid, $planName) | Out-Null
            $updatedList = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/list")
            if (-not ((@($updatedList.Output) | ForEach-Object { $_.ToString() }) -join "`n" -match [regex]::Escape($targetGuid))) {
                throw "Power scheme verification failed after creation: $targetGuid"
            }
        }
    }

    if ($activeGuid -ne $targetGuid) {
        $activateId = Register-OptimizationChange -Kind "PowerActiveScheme" -Target $targetGuid -OriginalValue $activeGuid -NewValue $targetGuid -Description "Activate optimizer power scheme"
        Complete-TrackedOperation -ChangeId $activateId -Action {
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setactive", $targetGuid) | Out-Null
            if ((Get-ActivePowerSchemeGuid) -ne $targetGuid) {
                throw "Power scheme verification failed after activation: $targetGuid"
            }
        }
    }

    Write-LogItem -ItemName "Ultimate Performance Plan" -Description "Activated $targetGuid" -Status "SUCCESS"
}

function Set-TrackedActivePowerScheme {
    param([Parameter(Mandatory = $true)][string]$Target)

    if ($Target -eq "ultimatePerformance") {
        Enable-TrackedUltimatePerformancePlan
        return
    }

    $activeGuid = Get-ActivePowerSchemeGuid
    $targetArgument = if ($Target -eq "balanced") { "SCHEME_BALANCED" } else { $Target }
    $expectedGuid = if ($Target -eq "balanced") { "381b4222-f694-41f0-9685-ff5bb260df2e" } else { $Target.ToLowerInvariant() }
    if ($activeGuid -eq $expectedGuid) { return }
    $changeId = Register-OptimizationChange -Kind "PowerActiveScheme" -Target $targetArgument -OriginalValue $activeGuid -NewValue $targetArgument -Description "Set active power scheme"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setactive", $targetArgument) | Out-Null
        if ((Get-ActivePowerSchemeGuid) -ne $expectedGuid) {
            throw "Power scheme verification failed after activation: $expectedGuid"
        }
    }
}

function Invoke-PowerManagementOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "Power Management Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "ultimatePerformancePlan") {
        Set-TrackedActivePowerScheme -Target ([string](Get-ConfigItemTarget $Config "powerManagement" "ultimatePerformancePlan"))
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "minProcessorState100") {
        $minimumProcessorState = Get-ConfigItemTarget $Config "powerManagement" "minProcessorState100"
        if ($minimumProcessorState -eq "systemDefault") { throw "A numeric minimum processor state is required" }
        Set-TrackedPowerSetting -Subgroup "SUB_PROCESSOR" -Setting "PROCTHROTTLEMIN" -Value ([uint32]$minimumProcessorState) -Description "Set minimum processor state on AC power" | Out-Null
        Write-LogItem -ItemName "Minimum processor state" -Description "$minimumProcessorState percent" -Status "SUCCESS"
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disablePowerThrottling") {
        $powerThrottlingEnabled = [bool](Get-ConfigItemTarget $Config "powerManagement" "disablePowerThrottling")
        if ($powerThrottlingEnabled) {
            Remove-RegistryValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "PowerThrottlingOff" -Description "Restore power throttling" | Out-Null
        } else {
            Set-RegistryValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "PowerThrottlingOff" -Value 1 -Type DWord -Description "Disable power throttling" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableUsbSuspend") {
        $usbSuspendEnabled = [bool](Get-ConfigItemTarget $Config "powerManagement" "disableUsbSuspend")
        Set-TrackedPowerSetting -Subgroup "2a737441-1930-4402-8d77-b2bebba308a3" -Setting "48e6b7a6-50f5-4782-a5d4-53bb8f07e226" -Value ([uint32][int]$usbSuspendEnabled) -Description "Set USB selective suspend on AC power" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disablePcieLpm") {
        $pcieTarget = Get-ConfigItemTarget $Config "powerManagement" "disablePcieLpm"
        if ($pcieTarget -eq "systemDefault") { throw "An explicit PCIe link-state value is required" }
        Set-TrackedPowerSetting -Subgroup "501a4d13-42af-4429-9fd1-a8218c268e20" -Setting "ee12f906-d277-404b-b6da-e5fa1a576df5" -Value ([uint32]$pcieTarget) -Description "Set PCIe link state power management on AC power" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableDiskAutoOff") {
        $diskTimeout = Get-ConfigItemTarget $Config "powerManagement" "disableDiskAutoOff"
        if ($diskTimeout -eq "systemDefault") { throw "An explicit disk timeout is required" }
        Set-TrackedPowerSetting -Subgroup "0012ee47-9041-4b5d-9b77-535fba8b1442" -Setting "6738e2c4-e8a5-4a42-b16a-e040e769756e" -Value ([uint32]$diskTimeout) -Description "Set disk idle timeout on AC power" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "aggressiveBoost") {
        $boostTarget = Get-ConfigItemTarget $Config "powerManagement" "aggressiveBoost"
        if ($boostTarget -eq "systemDefault") { throw "An explicit processor boost mode is required" }
        Set-TrackedPowerSetting -Subgroup "SUB_PROCESSOR" -Setting "PERFBOOSTMODE" -Value ([uint32]$boostTarget) -Description "Set processor boost mode on AC power" | Out-Null
    }
}
