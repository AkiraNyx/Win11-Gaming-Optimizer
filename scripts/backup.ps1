#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$LogDir,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
if (-not $OutputDir) {
    $OutputDir = if ([string]::IsNullOrWhiteSpace($env:WIN11OPTIMIZER_DATA_DIR)) {
        Join-Path $PSScriptRoot "..\config\output"
    } else {
        $env:WIN11OPTIMIZER_DATA_DIR
    }
}
if (-not $LogDir) { $LogDir = Join-Path $PSScriptRoot ".." }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$LogDir = [IO.Path]::GetFullPath($LogDir)
$utilsPath = Join-Path $PSScriptRoot "utils"

try {
    Import-Module (Join-Path $utilsPath "NativeCommand.psm1") -Force
    Import-Module (Join-Path $utilsPath "Logging.psm1") -Force
    Import-Module (Join-Path $utilsPath "Backup.psm1") -Force
    Initialize-Log -LogDirectory $LogDir
} catch {
    Write-Error "Backup initialization failed: $($_.Exception.Message)"
    exit 1
}

Write-LogSection "Creating Backup"
if (-not (Test-ProcessAdministrator)) {
    Write-LogEntry "Administrator privileges are required to create a complete backup" -Level "ERROR"
    exit 1
}

$mutationLock = $null
try {
    try {
        $mutationLock = Enter-OptimizerMutationLock
    } catch {
        Write-LogEntry "Backup cannot start: $($_.Exception.Message)" -Level "ERROR"
        exit 3
    }

    $result = New-OptimizationBackup -OutputDirectory $OutputDir
    foreach ($warning in @($result.Warnings)) { Write-LogEntry $warning -Level "WARN" }
    foreach ($backupError in @($result.Errors)) { Write-LogEntry $backupError -Level "ERROR" }
    if (-not $result.Success) {
        Write-LogEntry "Backup is incomplete: $($result.BackupDirectory)" -Level "ERROR"
        if ($PassThru) { Write-Output $result }
        exit 1
    }

    Write-LogSection "Backup Complete"
    Write-LogEntry "Backup saved: $($result.BackupDirectory)"
    if ($PassThru) { Write-Output $result }
    else { Write-Output "Backup saved: $($result.BackupDirectory)" }
    exit 0
} catch {
    Write-LogEntry "Backup failed: $($_.Exception.Message)" -Level "ERROR"
    exit 1
} finally {
    if ($mutationLock) { Exit-OptimizerMutationLock -Lock $mutationLock }
}
