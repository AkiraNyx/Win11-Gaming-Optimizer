#Requires -Version 5.1

$ErrorActionPreference = "Stop"

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message (expected: $Expected; actual: $Actual)"
    }
}

function Assert-Match {
    param([string]$Actual, [string]$Pattern, [string]$Message)
    if ($Actual -notmatch $Pattern) {
        throw "$Message"
    }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$commonPath = Join-Path $repositoryRoot "scripts\modules\Common.psm1"
$networkPath = Join-Path $repositoryRoot "scripts\modules\NetworkOptimization.psm1"
$changeTrackingPath = Join-Path $repositoryRoot "scripts\utils\ChangeTracking.psm1"
$commonSource = Get-Content -LiteralPath $commonPath -Raw
$networkSource = Get-Content -LiteralPath $networkPath -Raw
$changeTrackingSource = Get-Content -LiteralPath $changeTrackingPath -Raw

Assert-Match $commonSource 'ArgumentList @\("/qh", \$SchemeGuid, \$Subgroup, \$Setting\)' "Power snapshots must query hidden settings"
Assert-Match $changeTrackingSource 'ArgumentList @\("/qh", \$scheme, \$subgroup, \$setting\)' "Power restore verification must query hidden settings"
Assert-Match $networkSource '(?s)Disable-NetAdapterPowerManagement[^}]+Wait-NetAdapterPowerManagementReady' "Disabling adapter power management must wait for restart completion"
Assert-Match $networkSource '(?s)Enable-NetAdapterPowerManagement[^}]+Wait-NetAdapterPowerManagementReady' "Enabling adapter power management must wait for restart completion"
Assert-Match $changeTrackingSource '(?s)Set-NetAdapterPowerManagement @parameters\s+\$updated = Wait-NetAdapterPowerManagementReady' "Adapter power restore must wait before verification"

# Match main.ps1: load optimization modules, then republish the global utility module.
Import-Module -Name $commonPath -Force
Import-Module -Name $networkPath -Force
$changeTrackingModule = Import-Module -Name $changeTrackingPath -Force -PassThru
$networkModule = Get-Module NetworkOptimization
$resolvedWaitSource = & $networkModule { (Get-Command Wait-NetAdapterPowerManagementReady -ErrorAction Stop).Source }
Assert-Equal $resolvedWaitSource "ChangeTracking" "The network module must resolve the republished readiness wait"

$waitState = @{ AdapterChecks = 0; PowerChecks = 0; Sleeps = 0 }
$readyPower = & $changeTrackingModule {
    param($State)
    function Get-NetAdapter {
        param([string]$Name)
        $State.AdapterChecks++
        return [PSCustomObject]@{ Status = if ($State.AdapterChecks -eq 1) { "Disconnected" } else { "Up" } }
    }
    function Get-NetAdapterPowerManagement {
        param([string]$Name)
        $State.PowerChecks++
        if ($State.PowerChecks -eq 1) { throw "Adapter is restarting" }
        return [PSCustomObject]@{ ArpOffload = "Disabled" }
    }
    function Start-Sleep {
        param([int]$Milliseconds)
        $State.Sleeps++
    }
    try {
        Wait-NetAdapterPowerManagementReady -Name "Ethernet" -PollIntervalMilliseconds 1
    } finally {
        Remove-Item Function:\Get-NetAdapter -Force -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-NetAdapterPowerManagement -Force -ErrorAction SilentlyContinue
        Remove-Item Function:\Start-Sleep -Force -ErrorAction SilentlyContinue
    }
} $waitState
Assert-Equal $readyPower.ArpOffload "Disabled" "The readiness wait must return readable power-management state"
Assert-Equal $waitState.AdapterChecks 3 "The readiness wait must poll until the adapter is Up and readable"
Assert-Equal $waitState.PowerChecks 2 "The readiness wait must retry transient power-query failures"
Assert-Equal $waitState.Sleeps 2 "The readiness wait must pause between failed probes"

$timeoutError = & $changeTrackingModule {
    function Get-NetAdapter { return [PSCustomObject]@{ Status = "Disconnected" } }
    function Start-Sleep { throw "A zero-second timeout must not sleep" }
    try {
        Wait-NetAdapterPowerManagementReady -Name "Ethernet" -TimeoutSeconds 0
        return ""
    } catch {
        return $_.Exception.Message
    } finally {
        Remove-Item Function:\Get-NetAdapter -Force -ErrorAction SilentlyContinue
        Remove-Item Function:\Start-Sleep -Force -ErrorAction SilentlyContinue
    }
}
Assert-Match $timeoutError "Timed out waiting for network adapter 'Ethernet'.*Up.*readable power-management settings" "A readiness timeout must identify the adapter and required state"

Write-Output "Power and network regression tests passed"
