#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-TaskSchedulingOptimization {
    [CmdletBinding()]
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "Task Scheduling Optimization"

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "enableGameMode") {
        $gameModeEnabled = [bool](Get-ConfigItemTarget $Config "taskScheduling" "enableGameMode")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\GameBar" -Name "AllowAutoGameMode" -Value ([int]$gameModeEnabled) -Type DWord -Description "Set Game Mode target" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "foregroundPriority") {
        $priorityTarget = Get-ConfigItemTarget $Config "taskScheduling" "foregroundPriority"
        $priorityPath = "HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl"
        if ($priorityTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $priorityPath -Name "Win32PrioritySeparation" -Description "Restore default foreground scheduling" | Out-Null
        } else {
            Set-RegistryValue -Path $priorityPath -Name "Win32PrioritySeparation" -Value ([int]$priorityTarget) -Type DWord -Description "Set foreground scheduling priority" | Out-Null
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableBackgroundApps") {
        $backgroundTarget = Get-ConfigItemTarget $Config "taskScheduling" "disableBackgroundApps"
        $backgroundPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy"
        if ($backgroundTarget -eq "userControl") {
            Remove-RegistryValue -Path $backgroundPath -Name "LetAppsRunInBackground" -Description "Restore user-controlled background apps" | Out-Null
        } else {
            $backgroundValue = if ($backgroundTarget -eq "forceAllow") { 1 } else { 2 }
            Set-RegistryValue -Path $backgroundPath -Name "LetAppsRunInBackground" -Value $backgroundValue -Type DWord -Description "Set background app policy" | Out-Null
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableGameDVR") {
        $gameDvrEnabled = [bool](Get-ConfigItemTarget $Config "taskScheduling" "disableGameDVR")
        if ($gameDvrEnabled) {
            Set-RegistryValue -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -Value 1 -Type DWord -Description "Enable Game DVR" | Out-Null
            Remove-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name "AllowGameDVR" -Description "Restore Game DVR policy" | Out-Null
        } else {
            Set-RegistryValue -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -Value 0 -Type DWord -Description "Disable Game DVR" | Out-Null
            Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name "AllowGameDVR" -Value 0 -Type DWord -Description "Disable Game DVR policy" | Out-Null
        }
    }
}
