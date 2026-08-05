#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Service.psm1") -Force

function ConvertTo-ServiceStartupType {
    param([Parameter(Mandatory = $true)][string]$Target)
    return @{
        automatic = "Automatic"
        automaticDelayed = "AutomaticDelayedStart"
        manual = "Manual"
        disabled = "Disabled"
    }[$Target]
}

function Get-ServiceStartupTarget {
    param([Parameter(Mandatory = $true)][string]$ServiceName)
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { return $null }
    if ($service.StartType.ToString() -eq "Disabled") { return "disabled" }
    if ($service.StartType.ToString() -eq "Manual") { return "manual" }
    $serviceConfig = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name "DelayedAutoStart" -ErrorAction SilentlyContinue
    if ([int]$serviceConfig.DelayedAutoStart -eq 1) { return "automaticDelayed" }
    return "automatic"
}

function Invoke-ServiceOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "Service Optimization"
    $errors = [System.Collections.ArrayList]::new()
    $services = @(
        @{Name="DiagTrack";Key="telemetry";Desc="Telemetry"}
        @{Name="Fax";Key="fax";Desc="Fax Service"}
        @{Name="RemoteRegistry";Key="remoteRegistry";Desc="Remote Registry"}
        @{Name="WerSvc";Key="errorReporting";Desc="Error Reporting"}
        @{Name="SysMain";Key="sysMain";Desc="SysMain/Superfetch"}
        @{Name="WSearch";Key="windowsSearch";Desc="Windows Search"}
        @{Name="XblAuthManager";Key="xboxAuth";Desc="Xbox Auth"}
        @{Name="XblGameSave";Key="xboxGameSave";Desc="Xbox Game Save"}
        @{Name="XboxNetApiSvc";Key="xboxNetwork";Desc="Xbox Network"}
        @{Name="XboxGipSvc";Key="xboxGip";Desc="Xbox GIP"}
        @{Name="diagnosticshub.standardcollector.service";Key="diagHub";Desc="Diagnostics Hub"}
    )
    foreach ($svc in $services) {
        if (Test-OptimizationItemPlanned -Items $Items -ItemName $svc.Key) {
            $target = [string](Get-ConfigItemTarget $Config "serviceOptimization" $svc.Key)
            $startupType = ConvertTo-ServiceStartupType -Target $target
            $result = Set-ServiceStartup -ServiceName $svc.Name -StartupType $startupType -Description $svc.Desc
            if ($result.Success) { Write-LogItem -ItemName $svc.Desc -Description $result.Message -Status "SUCCESS" }
            else {
                Write-LogItem -ItemName $svc.Desc -Description $result.Message -Status "WARN"
                $errors.Add($result.Message) | Out-Null
            }
        }
    }
    # Print Spooler (dynamic)
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "printSpooler") {
        $printTarget = [string](Get-ConfigItemTarget $Config "serviceOptimization" "printSpooler")
        $printCurrent = Get-ServiceStartupTarget -ServiceName "Spooler"
        if ($printCurrent -ne $printTarget) {
            if ($printTarget -eq "disabled") {
                $hasPrinter = Get-CimInstance Win32_Printer -ErrorAction Stop | Where-Object { $_.Name -notmatch "Microsoft Print|OneNote|XPS" }
                if ($hasPrinter) {
                    $errors.Add("Print Spooler cannot be disabled because a printer is installed") | Out-Null
                    $printCurrent = $printTarget
                }
            }
            if ($printCurrent -ne $printTarget) {
                $result = Set-ServiceStartup -ServiceName "Spooler" -StartupType (ConvertTo-ServiceStartupType $printTarget) -Description "Print Spooler"
                if (-not $result.Success) { $errors.Add($result.Message) | Out-Null }
            }
        }
    }
    # Bluetooth (dynamic)
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "bluetooth") {
        $btTarget = [string](Get-ConfigItemTarget $Config "serviceOptimization" "bluetooth")
        $btCurrent = Get-ServiceStartupTarget -ServiceName "bthserv"
        if ($btCurrent -ne $btTarget) {
            if ($btTarget -eq "disabled") {
                $hasBT = Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object {
                    $_.PNPClass -eq "Bluetooth" -or $_.ClassGuid -eq "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}" -or $_.Name -match "Bluetooth"
                }
                if ($hasBT) {
                    $errors.Add("Bluetooth support cannot be disabled because Bluetooth hardware is installed") | Out-Null
                    $btCurrent = $btTarget
                }
            }
            if ($btCurrent -ne $btTarget) {
                $result = Set-ServiceStartup -ServiceName "bthserv" -StartupType (ConvertTo-ServiceStartupType $btTarget) -Description "Bluetooth support"
                if (-not $result.Success) { $errors.Add($result.Message) | Out-Null }
            }
        }
    }
    if ($errors.Count -gt 0) { throw "One or more service changes failed: $($errors -join '; ')" }
}
