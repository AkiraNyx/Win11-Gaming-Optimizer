#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-PrivacyOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "Privacy Optimization"
    $dcPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "telemetryMinimal") {
        $telemetryTarget = Get-ConfigItemTarget $Config "privacyOptimization" "telemetryMinimal"
        if ($telemetryTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $dcPath -Name "AllowTelemetry" -Description "Restore default telemetry policy" | Out-Null
        } else {
            Set-RegistryValue -Path $dcPath -Name "AllowTelemetry" -Value ([int]$telemetryTarget) -Type DWord -Description "Set telemetry level" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableAdId") {
        $adId = [int][bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableAdId")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo" -Name "Enabled" -Value $adId -Type DWord -Description "Set advertising ID target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableActivityHistory") {
        $activityHistory = [int][bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableActivityHistory")
        $sysPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System"
        Set-RegistryValue -Path $sysPath -Name "EnableActivityFeed" -Value $activityHistory -Type DWord -Description "Set activity feed target" | Out-Null
        Set-RegistryValue -Path $sysPath -Name "PublishUserActivities" -Value $activityHistory -Type DWord -Description "Set activity publishing target" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableLocation") {
        $locationEnabled = [bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableLocation")
        $locPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors"
        if ($locationEnabled) {
            Remove-RegistryValue -Path $locPath -Name "DisableLocation" -Description "Restore location policy" | Out-Null
        } else {
            Set-RegistryValue -Path $locPath -Name "DisableLocation" -Value 1 -Type DWord -Description "Disable location tracking"
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableDiagViewer") {
        $diagViewer = [int][bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableDiagViewer")
        Set-RegistryValue -Path $dcPath -Name "DiagnosticDataViewer" -Value $diagViewer -Type DWord -Description "Set diagnostic viewer target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableSuggestions") {
        $suggestions = [int][bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableSuggestions")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SubscribedContent-338389Enabled" -Value $suggestions -Type DWord -Description "Set suggestions target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableStartSuggestions") {
        $startSuggestions = [int][bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableStartSuggestions")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" -Name "SystemPaneSuggestionsEnabled" -Value $startSuggestions -Type DWord -Description "Set Start suggestions target" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableCortana") {
        $cortanaEnabled = [bool](Get-ConfigItemTarget $Config "privacyOptimization" "disableCortana")
        $searchPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search"
        if ($cortanaEnabled) {
            Remove-RegistryValue -Path $searchPath -Name "AllowCortana" -Description "Restore Cortana policy" | Out-Null
        } else {
            Set-RegistryValue -Path $searchPath -Name "AllowCortana" -Value 0 -Type DWord -Description "Disable Cortana"
        }
    }
}
