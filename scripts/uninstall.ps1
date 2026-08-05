#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Confirm,
    [string]$LogDir
)

$ErrorActionPreference = "Stop"
if (-not $LogDir) { $LogDir = Join-Path $PSScriptRoot ".." }
$LogDir = [IO.Path]::GetFullPath($LogDir)
$outputDirectory = if ([string]::IsNullOrWhiteSpace($env:WIN11OPTIMIZER_DATA_DIR)) {
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\config\output"))
} else {
    [IO.Path]::GetFullPath($env:WIN11OPTIMIZER_DATA_DIR)
}
$utilsPath = Join-Path $PSScriptRoot "utils"

try {
    Import-Module (Join-Path $utilsPath "NativeCommand.psm1") -Force
    Import-Module (Join-Path $utilsPath "ChangeTracking.psm1") -Force
    Import-Module (Join-Path $utilsPath "Logging.psm1") -Force
    Import-Module (Join-Path $utilsPath "Registry.psm1") -Force
    Import-Module (Join-Path $utilsPath "Service.psm1") -Force
    Import-Module (Join-Path $utilsPath "RestorePoint.psm1") -Force
    Initialize-Log -LogDirectory $LogDir
} catch {
    Write-Error "Uninstall initialization failed: $($_.Exception.Message)"
    exit 1
}

Write-LogSection "Full Uninstall"
if (-not (Test-ProcessAdministrator)) {
    Write-LogEntry "Administrator privileges are required to restore optimized settings" -Level "ERROR"
    exit 1
}

if (-not $Confirm) {
    $response = Read-Host "Type YES to restore all settings tracked by Win11Optimizer"
    if ($response -ne "YES") {
        Write-LogEntry "Cancelled by user"
        exit 0
    }
}

$mutationLock = $null
try {
    try {
        $mutationLock = Enter-OptimizerMutationLock
    } catch {
        Write-LogEntry "Tracked-settings restore cannot start: $($_.Exception.Message)" -Level "ERROR"
        exit 3
    }

if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    Write-LogEntry "No optimizer output directory was found; nothing can be safely uninstalled" -Level "ERROR"
    exit 1
}

$manifests = [System.Collections.ArrayList]::new()
$discoveryErrors = [System.Collections.ArrayList]::new()
foreach ($file in @(Get-ChildItem -LiteralPath $outputDirectory -File -Filter "changes_*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)) {
    try {
        $manifest = Read-OptimizationChangeManifest -Path $file.FullName
        $restoreState = Get-OptimizationManifestRestoreState -Manifest $manifest
        if ($restoreState.State -eq "Inconsistent") {
            throw "Session is marked Restored, but $($restoreState.UnrestoredCount) record(s) still require review; automatic replay is unsafe"
        }
        if ($restoreState.State -ne "Restored") {
            $manifests.Add([PSCustomObject]@{ Path = $file.FullName; Manifest = $manifest; CreatedAt = [DateTime]$manifest.CreatedAt }) | Out-Null
        }
    } catch {
        $discoveryErrors.Add("$($file.FullName): $($_.Exception.Message)") | Out-Null
    }
}

if ($manifests.Count -eq 0) {
    foreach ($message in @($discoveryErrors.ToArray())) { Write-LogEntry $message -Level "ERROR" }
    if ($discoveryErrors.Count -gt 0) {
        Write-LogEntry "No valid unrestored change manifests were found" -Level "ERROR"
        exit 1
    }
    Write-LogEntry "All recorded optimization sessions have already been restored" -Level "INFO"
    exit 0
}

if ($discoveryErrors.Count -gt 0) {
    foreach ($message in @($discoveryErrors.ToArray())) { Write-LogEntry $message -Level "ERROR" }
    Write-LogEntry "Tracked-settings restore stopped before making changes because one or more journals could not be validated" -Level "ERROR"
    exit 1
}

$restorePoint = New-OptimizationRestorePoint -Description ("Win11Opt-PreUninstall-{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
Write-LogEntry $restorePoint.Message -Level $(if ($restorePoint.Success) { "SUCCESS" } else { "WARN" })

$allErrors = [System.Collections.ArrayList]::new()
$restoredSessions = 0
$restoredEntries = 0
foreach ($entry in @($manifests | Sort-Object CreatedAt -Descending)) {
    Write-LogEntry "Restoring session: $($entry.Path)"
    $sessionErrors = [System.Collections.ArrayList]::new()
    $sessionRestoredEntries = 0
    try {
        $restoreResult = Invoke-OptimizationManifestRestore -ChangesJsonPath $entry.Path `
            -RegistryRestoreAction { param($change) Restore-RegistryChangeRecord -Change $change } `
            -ServiceRestoreAction { param($change) Restore-ServiceChangeRecord -Change $change }
        $sessionRestoredEntries = [int]$restoreResult.RestoredCount
        foreach ($message in @($restoreResult.Errors)) {
            $sessionErrors.Add($message) | Out-Null
            $allErrors.Add("$($entry.Path): $message") | Out-Null
        }
    } catch {
        $sessionErrors.Add($_.Exception.Message) | Out-Null
        $allErrors.Add("$($entry.Path): $($_.Exception.Message)") | Out-Null
    }

    if ($sessionErrors.Count -eq 0) {
        Set-OptimizationManifestStatus -Path $entry.Path -Status Restored
        $restoredSessions++
        $restoredEntries += $sessionRestoredEntries
        Write-LogEntry "$sessionRestoredEntries change(s) restored; previously restored records were skipped" -Level "SUCCESS"
    } else {
        Set-OptimizationManifestStatus -Path $entry.Path -Status RestoreFailed -Errors @($sessionErrors.ToArray())
        foreach ($message in @($sessionErrors.ToArray())) { Write-LogEntry $message -Level "ERROR" }
        Write-LogEntry "$sessionRestoredEntries change(s) were restored and journaled; failed and deferred records remain available for retry" -Level "WARN"
        Write-LogEntry "Older sessions were left untouched because rollback order must be preserved" -Level "ERROR"
        break
    }
}

if ($allErrors.Count -gt 0) {
    Write-LogSection "Uninstall Partially Failed"
    Write-LogEntry "$restoredSessions session(s) restored; $($allErrors.Count) error(s) remain" -Level "ERROR"
    exit 1
}

Write-LogSection "Uninstall Complete"
Write-LogEntry "$restoredSessions optimization session(s) and $restoredEntries pending change(s) were restored. Restart recommended." -Level "SUCCESS"
Write-Host "Tracked optimizations were restored. Restart recommended." -ForegroundColor Green
exit 0
} finally {
    if ($mutationLock) { Exit-OptimizerMutationLock -Lock $mutationLock }
}
