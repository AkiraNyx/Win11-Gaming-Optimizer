#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$UseSystemRestore,
    [string]$ChangesJsonPath,
    [string]$BackupPath,
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
    Import-Module (Join-Path $utilsPath "Backup.psm1") -Force
    Initialize-Log -LogDirectory $LogDir
} catch {
    Write-Error "Restore initialization failed: $($_.Exception.Message)"
    exit 1
}

function Resolve-OptimizerOutputPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet("Leaf","Container")][string]$PathType
    )

    if (-not (Test-Path -LiteralPath $Path -PathType $PathType)) { throw "Requested restore source was not found: $Path" }
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $root = $outputDirectory.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Restore sources must be inside the optimizer output directory: $outputDirectory"
    }
    return $resolved
}

function Get-LatestChangeManifestPath {
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { return $null }
    $candidates = foreach ($file in @(Get-ChildItem -LiteralPath $outputDirectory -File -Filter "changes_*.json" -ErrorAction SilentlyContinue)) {
        $manifest = Read-OptimizationChangeManifest -Path $file.FullName
        $restoreState = Get-OptimizationManifestRestoreState -Manifest $manifest
        if ($restoreState.State -eq "Inconsistent") {
            throw "The change manifest is inconsistent: its session is marked Restored, but $($restoreState.UnrestoredCount) record(s) still require review. Select a verified restore source explicitly: $($file.FullName)"
        }
        if ($restoreState.State -eq "Restored") { continue }
        if ($restoreState.UnrestoredCount -eq 0) { continue }
        [PSCustomObject]@{ Path = $file.FullName; CreatedAt = [DateTime]$manifest.CreatedAt }
    }
    return $candidates | Sort-Object CreatedAt -Descending | Select-Object -First 1 -ExpandProperty Path
}

function Get-LatestBackupManifestPath {
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { return $null }
    return Get-ChildItem -LiteralPath $outputDirectory -Directory -Filter "backup_*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        ForEach-Object { Join-Path $_.FullName "backup_manifest.json" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}

function Assert-ChangeManifestRestorable {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $restoreState = Get-OptimizationManifestRestoreState -Manifest $Manifest
    if ($restoreState.State -eq "Inconsistent") {
        throw "The selected change manifest is inconsistent: its session is marked Restored, but $($restoreState.UnrestoredCount) record(s) still require review. Automatic replay is unsafe; select a verified restore source: $Path"
    }
    if ($restoreState.State -eq "Restored") {
        throw "The selected change manifest has already been restored and cannot be replayed: $Path"
    }
    if ($restoreState.UnrestoredCount -eq 0) {
        throw "The selected change manifest contains no tracked changes to restore: $Path"
    }
}

Write-LogSection "Windows 11 Gaming Optimizer - Restore"
if ($PSBoundParameters.ContainsKey("ChangesJsonPath") -and -not (Test-Path -LiteralPath $ChangesJsonPath -PathType Leaf)) {
    Write-LogEntry "The explicitly requested change manifest does not exist: $ChangesJsonPath" -Level "ERROR"
    exit 2
}
if ($PSBoundParameters.ContainsKey("BackupPath") -and -not (Test-Path -LiteralPath $BackupPath)) {
    Write-LogEntry "The explicitly requested backup does not exist: $BackupPath" -Level "ERROR"
    exit 2
}
if ($ChangesJsonPath -and $BackupPath) {
    Write-LogEntry "Specify either ChangesJsonPath or BackupPath, not both" -Level "ERROR"
    exit 2
}
if (-not (Test-ProcessAdministrator)) {
    Write-LogEntry "Administrator privileges are required to restore system settings" -Level "ERROR"
    exit 1
}

$mutationLock = $null
try {
    try {
        $mutationLock = Enter-OptimizerMutationLock
    } catch {
        Write-LogEntry "Restore cannot start: $($_.Exception.Message)" -Level "ERROR"
        exit 3
    }

    if ($UseSystemRestore) {
        $sequenceNumber = $null
        $expectedDescription = $null
        if ($ChangesJsonPath) {
            $resolvedChanges = Resolve-OptimizerOutputPath -Path $ChangesJsonPath -PathType Leaf
            $manifest = Read-OptimizationChangeManifest -Path $resolvedChanges
            Assert-ChangeManifestRestorable -Manifest $manifest -Path $resolvedChanges
            $sequenceNumber = $manifest.RestorePointSequenceNumber
            $expectedDescription = $manifest.RestorePointDescription
        } elseif ($BackupPath) {
            $backupPathType = if (Test-Path -LiteralPath $BackupPath -PathType Container) { "Container" } else { "Leaf" }
            $resolvedBackup = Resolve-OptimizerOutputPath -Path $BackupPath -PathType $backupPathType
            $backup = Read-OptimizationBackupManifest -BackupPath $resolvedBackup
            $sequenceNumber = $backup.Manifest.RestorePointSequenceNumber
            $expectedDescription = $backup.Manifest.RestorePointDescription
        } else {
            $latestChanges = Get-LatestChangeManifestPath
            if ($latestChanges) {
                $manifest = Read-OptimizationChangeManifest -Path $latestChanges
                $sequenceNumber = $manifest.RestorePointSequenceNumber
                $expectedDescription = $manifest.RestorePointDescription
            } else {
                $latestBackup = Get-LatestBackupManifestPath
                if (-not $latestBackup) { throw "No optimizer restore manifest was found" }
                $backup = Read-OptimizationBackupManifest -BackupPath $latestBackup
                $sequenceNumber = $backup.Manifest.RestorePointSequenceNumber
                $expectedDescription = $backup.Manifest.RestorePointDescription
            }
        }

        if (-not $sequenceNumber) { throw "The selected optimizer manifest has no system restore point sequence number" }
        Write-LogEntry "Starting optimizer restore point sequence $sequenceNumber"
        $result = New-SystemRestore -SequenceNumber ([int]$sequenceNumber) -ExpectedDescription ([string]$expectedDescription)
        Write-LogEntry $result.Message -Level $(if ($result.Success) { "SUCCESS" } else { "ERROR" })
        if (-not $result.Success) { exit 1 }
        exit 0
    }

    if ($ChangesJsonPath -or (-not $BackupPath -and (Get-LatestChangeManifestPath))) {
        $selectedChanges = if ($ChangesJsonPath) { $ChangesJsonPath } else { Get-LatestChangeManifestPath }
        $selectedChanges = Resolve-OptimizerOutputPath -Path $selectedChanges -PathType Leaf
        $selectedManifest = Read-OptimizationChangeManifest -Path $selectedChanges
        Assert-ChangeManifestRestorable -Manifest $selectedManifest -Path $selectedChanges
        Write-LogEntry "Restoring tracked session: $selectedChanges"

        $allErrors = [System.Collections.ArrayList]::new()
        $restoreResult = Invoke-OptimizationManifestRestore -ChangesJsonPath $selectedChanges `
            -RegistryRestoreAction { param($change) Restore-RegistryChangeRecord -Change $change } `
            -ServiceRestoreAction { param($change) Restore-ServiceChangeRecord -Change $change }
        $restoredThisRun = [int]$restoreResult.RestoredCount
        foreach ($message in @($restoreResult.Errors)) {
            $allErrors.Add($message) | Out-Null
            Write-LogEntry $message -Level "ERROR"
        }

        if ($allErrors.Count -gt 0) {
            Set-OptimizationManifestStatus -Path $selectedChanges -Status RestoreFailed -Errors @($allErrors.ToArray())
            Write-LogEntry "$restoredThisRun change(s) were restored and journaled; failed and deferred records remain available for retry" -Level "WARN"
            Write-LogEntry "Restore completed with $($allErrors.Count) error(s)" -Level "ERROR"
            exit 1
        }

        Set-OptimizationManifestStatus -Path $selectedChanges -Status Restored
        Write-LogSection "Restore Complete"
        Write-LogEntry "$restoredThisRun change(s) were restored; previously restored records were skipped. Restart recommended." -Level "SUCCESS"
        exit 0
    }

    if (-not $BackupPath) { throw "No unrestored optimizer change manifest was found" }
    $selectedBackup = $BackupPath
    $selectedBackup = if (Test-Path -LiteralPath $selectedBackup -PathType Container) {
        Resolve-OptimizerOutputPath -Path $selectedBackup -PathType Container
    } else {
        Resolve-OptimizerOutputPath -Path $selectedBackup -PathType Leaf
    }
    Write-LogEntry "Restoring full backup: $selectedBackup"
    $backupResult = Restore-OptimizationBackup -BackupPath $selectedBackup
    foreach ($message in @($backupResult.Errors)) { Write-LogEntry $message -Level "ERROR" }
    if (-not $backupResult.Success) {
        Write-LogEntry "Backup restore completed with errors" -Level "ERROR"
        exit 1
    }

    Write-LogSection "Restore Complete"
    Write-LogEntry "Backup settings were restored. Restart recommended." -Level "SUCCESS"
    exit 0
} catch {
    Write-LogEntry "Restore failed: $($_.Exception.Message)" -Level "ERROR"
    exit 1
} finally {
    if ($mutationLock) { Exit-OptimizerMutationLock -Lock $mutationLock }
}
