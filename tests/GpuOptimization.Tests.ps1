#Requires -Version 5.1

$ErrorActionPreference = "Stop"

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message (expected: $Expected; actual: $Actual)" }
}

function Assert-Match {
    param([string]$Actual, [string]$Pattern, [string]$Message)
    if ($Actual -notmatch $Pattern) { throw "$Message (value: $Actual)" }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$gpuPath = Join-Path $repositoryRoot "scripts\modules\GPUOptimization.psm1"
$gpuSource = Get-Content -LiteralPath $gpuPath -Raw
Assert-Match $gpuSource 'no writable matching display adapter registry entry' "GPU zero-match results must be failures"
Import-Module -Name $gpuPath -Force
$gpuModule = Get-Module GPUOptimization
$calls = [System.Collections.ArrayList]::new()
$zeroMatchError = & $gpuModule {
    param($Calls)
    function Write-LogSection { param([string]$SectionName) }
    function Write-LogItem { param([string]$ItemName, [string]$Description, [string]$Status) }
    function Test-OptimizationItemPlanned { param([string[]]$Items, [string]$ItemName) return ($ItemName -eq "nvidiaOptimize") }
    function Test-ConfigItemCommand { return $true }
    function Get-DisplayAdapterRegistryEntries { return @([PSCustomObject]@{ Path = "HKLM:\Test"; Description = "Intel Test Adapter" }) }
    function Set-RegistryValue { $Calls.Add("write") | Out-Null }
    try {
        Invoke-GPUOptimization -Config ([PSCustomObject]@{}) -Items @("nvidiaOptimize")
        return ""
    } catch {
        return $_.Exception.Message
    } finally {
        Remove-Item Function:\Write-LogSection,Function:\Write-LogItem,Function:\Test-OptimizationItemPlanned,Function:\Test-ConfigItemCommand,Function:\Get-DisplayAdapterRegistryEntries,Function:\Set-RegistryValue -Force -ErrorAction SilentlyContinue
    }
} $calls
Assert-Match $zeroMatchError "no writable matching display adapter registry entry" "A selected GPU command with no matching adapter must fail"
Assert-Equal $calls.Count 0 "A zero-match GPU command must not report or perform a successful write"

Write-Output "GPU optimization regression tests passed"
