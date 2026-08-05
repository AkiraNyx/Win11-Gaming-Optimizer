#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-UIOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "UI Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableTransparency") {
        $transparency = [int][bool](Get-ConfigItemTarget $Config "uiOptimization" "disableTransparency")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" -Name "EnableTransparency" -Value $transparency -Type DWord -Description "Set transparency target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableAnimations") {
        $animations = if ([bool](Get-ConfigItemTarget $Config "uiOptimization" "disableAnimations")) { "1" } else { "0" }
        Set-RegistryValue -Path "HKCU:\Control Panel\Desktop\WindowMetrics" -Name "MinAnimate" -Value $animations -Type String -Description "Set window animation target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableShadows") {
        $shadows = [int][bool](Get-ConfigItemTarget $Config "uiOptimization" "disableShadows")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" -Name "ListviewShadow" -Value $shadows -Type DWord -Description "Set shadow target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableSnapAssist") {
        $snapAssist = [int][bool](Get-ConfigItemTarget $Config "uiOptimization" "disableSnapAssist")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" -Name "SnapAssist" -Value $snapAssist -Type DWord -Description "Set Snap Assist target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableWidgets") {
        $widgets = [int][bool](Get-ConfigItemTarget $Config "uiOptimization" "disableWidgets")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" -Name "TaskbarDa" -Value $widgets -Type DWord -Description "Set Widgets target" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableCopilot") {
        $copilotEnabled = [bool](Get-ConfigItemTarget $Config "uiOptimization" "disableCopilot")
        $copilotPath = "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot"
        if ($copilotEnabled) {
            Remove-RegistryValue -Path $copilotPath -Name "TurnOffWindowsCopilot" -Description "Restore Copilot policy" | Out-Null
        } else {
            Set-RegistryValue -Path $copilotPath -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Description "Disable Copilot" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableNotificationCenter") {
        $notificationCenterEnabled = [bool](Get-ConfigItemTarget $Config "uiOptimization" "disableNotificationCenter")
        $explorerPath = "HKCU:\Software\Policies\Microsoft\Windows\Explorer"
        if ($notificationCenterEnabled) {
            Remove-RegistryValue -Path $explorerPath -Name "DisableNotificationCenter" -Description "Restore notification center policy" | Out-Null
        } else {
            Set-RegistryValue -Path $explorerPath -Name "DisableNotificationCenter" -Value 1 -Type DWord -Description "Disable notification center" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "performanceVisualEffects") {
        $visualTarget = Get-ConfigItemTarget $Config "uiOptimization" "performanceVisualEffects"
        $visualPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
        if ($visualTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $visualPath -Name "VisualFXSetting" -Description "Restore default visual effects" | Out-Null
        } else {
            $visualValue = @{ appearance = 1; performance = 2; custom = 3 }[$visualTarget]
            Set-RegistryValue -Path $visualPath -Name "VisualFXSetting" -Value $visualValue -Type DWord -Description "Set visual effects target" | Out-Null
        }
    }
}
