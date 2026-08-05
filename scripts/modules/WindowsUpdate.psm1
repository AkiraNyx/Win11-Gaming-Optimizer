#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-WindowsUpdateOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "Windows Update Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableP2P") {
        $p2pEnabled = [bool](Get-ConfigItemTarget $Config "windowsUpdate" "disableP2P")
        if ($p2pEnabled) {
            Remove-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" -Name "DODownloadMode" -Description "Restore system-managed update distribution" | Out-Null
        } else {
            Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" -Name "DODownloadMode" -Value 0 -Type DWord -Description "Disable P2P update distribution" | Out-Null
        }
    }
    $policyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "deferQualityUpdates") {
        $qualityDays = Get-ConfigItemTarget $Config "windowsUpdate" "deferQualityUpdates"
        if ($qualityDays -eq "systemDefault") {
            Remove-RegistryValue -Path $policyPath -Name "DeferQualityUpdates" -Description "Restore default quality update policy" | Out-Null
            Remove-RegistryValue -Path $policyPath -Name "DeferQualityUpdatesPeriodInDays" -Description "Restore default quality update delay" | Out-Null
        } else {
            Set-RegistryValue -Path $policyPath -Name "DeferQualityUpdates" -Value 1 -Type DWord -Description "Enable quality update deferral" | Out-Null
            Set-RegistryValue -Path $policyPath -Name "DeferQualityUpdatesPeriodInDays" -Value ([int]$qualityDays) -Type DWord -Description "Set quality update deferral" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "deferFeatureUpdates") {
        $featureDays = Get-ConfigItemTarget $Config "windowsUpdate" "deferFeatureUpdates"
        if ($featureDays -eq "systemDefault") {
            Remove-RegistryValue -Path $policyPath -Name "DeferFeatureUpdates" -Description "Restore default feature update policy" | Out-Null
            Remove-RegistryValue -Path $policyPath -Name "DeferFeatureUpdatesPeriodInDays" -Description "Restore default feature update delay" | Out-Null
        } else {
            Set-RegistryValue -Path $policyPath -Name "DeferFeatureUpdates" -Value 1 -Type DWord -Description "Enable feature update deferral" | Out-Null
            Set-RegistryValue -Path $policyPath -Name "DeferFeatureUpdatesPeriodInDays" -Value ([int]$featureDays) -Type DWord -Description "Set feature update deferral" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableAutoDriverUpdate") {
        $driverUpdatesEnabled = [bool](Get-ConfigItemTarget $Config "windowsUpdate" "disableAutoDriverUpdate")
        if ($driverUpdatesEnabled) {
            Remove-RegistryValue -Path $policyPath -Name "ExcludeWUDriversInQualityUpdate" -Description "Restore automatic driver update policy" | Out-Null
        } else {
            Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" -Name "ExcludeWUDriversInQualityUpdate" -Value 1 -Type DWord -Description "Disable auto driver updates" | Out-Null
        }
    }
    $auPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableAutoUpdate") {
        $autoUpdateEnabled = [bool](Get-ConfigItemTarget $Config "windowsUpdate" "disableAutoUpdate")
        if ($autoUpdateEnabled) {
            Remove-RegistryValue -Path $auPath -Name "NoAutoUpdate" -Description "Restore automatic update policy" | Out-Null
        } else {
            Set-RegistryValue -Path $auPath -Name "NoAutoUpdate" -Value 1 -Type DWord -Description "Disable auto updates" | Out-Null
        }
    }
}
