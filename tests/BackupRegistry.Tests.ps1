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
$backupPath = Join-Path $repositoryRoot "scripts\utils\Backup.psm1"
$mainPath = Join-Path $repositoryRoot "scripts\main.ps1"
Import-Module -Name (Join-Path $repositoryRoot "scripts\utils\NativeCommand.psm1") -Force
Import-Module -Name $backupPath -Force

$backupSource = Get-Content -LiteralPath $backupPath -Raw -Encoding UTF8
$mainSource = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
Assert-Match $backupSource 'Registry inventory failed for \$path' "Registry inventory failures must not be reported as export failures"
Assert-Match $backupSource 'Registry value snapshot failed for display adapters' "Targeted GPU snapshot failures must identify their stage"
Assert-Match $backupSource 'Registry export failed for \$path' "Registry export failures must retain their own stage"
Assert-Match $backupSource 'Backup manifest write failed for \$Path' "Manifest persistence failures must identify their stage"
Assert-Match $backupSource 'function Assert-TrustedBackupStorage' "Full backup restore must require protected backup storage"
Assert-Match $backupSource 'StartValue = \$startupSnapshot.StartValue' "Service backups must preserve the raw startup value"
Assert-Match $mainSource 'New-OptimizationBackup[^\r\n]+-PlannedItems \$plannedItems' "Pre-apply backup must receive the final planned items"

$testId = [guid]::NewGuid().ToString("N")
$registryPath = "HKCU:\Software\Win11OptimizerTests\$testId"
$nativeRegistryPath = "HKCU\Software\Win11OptimizerTests\$testId"
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase "Win11OptBackupRegistry_$testId"))
if (-not $testRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw "Resolved test directory is outside the system temporary directory" }
$backupDirectory = Join-Path $testRoot "backup_registry_inventory"
$registryFile = Join-Path $backupDirectory "registry_01.reg"

try {
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $registryPath -Name "Original" -Value "before" -PropertyType String | Out-Null
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null

    $backupModule = Get-Module Backup
    $inventory = @(& $backupModule { param($Path) Get-RegistryValueInventory -RegistryPath $Path } $registryPath)
    Invoke-CheckedNativeCommand -FilePath "reg.exe" -ArgumentList @("export", $nativeRegistryPath, $registryFile, "/y") | Out-Null

    $manifest = [PSCustomObject][ordered]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        Kind = "PreApplyBackup"
        BackupId = "backup_registry_inventory"
        RegistryExports = @([PSCustomObject]@{
            RegistryPath = $registryPath
            File = "registry_01.reg"
            ValueInventory = $inventory
        })
        ServicesSnapshot = $null
        PowerScheme = $null
    }
    [IO.File]::WriteAllText(
        (Join-Path $backupDirectory "backup_manifest.json"),
        ($manifest | ConvertTo-Json -Depth 8),
        (New-Object Text.UTF8Encoding($false))
    )

    Set-ItemProperty -LiteralPath $registryPath -Name "Original" -Value "after"
    New-ItemProperty -LiteralPath $registryPath -Name "Added" -Value 1 -PropertyType DWord | Out-Null
    Set-Item -LiteralPath $registryPath -Value "added-default"
    $addedChild = Join-Path $registryPath "AddedChild"
    New-Item -Path $addedChild | Out-Null
    New-ItemProperty -LiteralPath $addedChild -Name "ChildAdded" -Value "added" -PropertyType String | Out-Null

    $restoreResult = & $backupModule {
        param($BackupPath)
        function Assert-TrustedBackupStorage { return $true }
        try { Restore-OptimizationBackup -BackupPath $BackupPath -SkipServices -SkipPower }
        finally { Remove-Item Function:\Assert-TrustedBackupStorage -Force -ErrorAction SilentlyContinue }
    } $backupDirectory
    Assert-Equal $restoreResult.Success $true "Inventory-aware registry restore must succeed: $($restoreResult.Errors -join '; ')"
    Assert-Equal (Get-ItemPropertyValue -LiteralPath $registryPath -Name "Original") "before" "The exported value must be restored"
    $rootValueNames = @((Get-Item -LiteralPath $registryPath).GetValueNames())
    Assert-Equal ($rootValueNames -contains "Added") $false "A value created after backup must be removed"
    Assert-Equal ($rootValueNames -contains "") $false "A default value created after backup must be removed"
    Assert-Equal (Test-Path -LiteralPath $addedChild) $true "A key created after backup may remain"
    Assert-Equal @((Get-Item -LiteralPath $addedChild).GetValueNames()).Count 0 "Values under a key created after backup must be removed"

    $manifest.RegistryExports = @([PSCustomObject]@{ RegistryPath = $registryPath; File = "registry_01.reg" })
    [IO.File]::WriteAllText(
        (Join-Path $backupDirectory "backup_manifest.json"),
        ($manifest | ConvertTo-Json -Depth 8),
        (New-Object Text.UTF8Encoding($false))
    )
    New-ItemProperty -LiteralPath $registryPath -Name "LegacyAdded" -Value 1 -PropertyType DWord | Out-Null
    $legacyResult = & $backupModule {
        param($BackupPath)
        function Assert-TrustedBackupStorage { return $true }
        try { Restore-OptimizationBackup -BackupPath $BackupPath -SkipServices -SkipPower }
        finally { Remove-Item Function:\Assert-TrustedBackupStorage -Force -ErrorAction SilentlyContinue }
    } $backupDirectory
    Assert-Equal $legacyResult.Success $true "A legacy schema 2 registry backup must remain restorable"
    Assert-Equal (@((Get-Item -LiteralPath $registryPath).GetValueNames()) -contains "LegacyAdded") $true "A legacy backup without inventory must retain merge behavior"

    $powerOnlyPlan = @([PSCustomObject]@{ Category = "powerManagement"; Item = "ultimatePerformancePlan" })
    $powerOnlySnapshots = @(& $backupModule {
        param($Plan)
        function Test-Path { [CmdletBinding()] param([string]$LiteralPath) throw "Unexpected display-adapter registry access" }
        try {
            Get-GpuRegistryValueSnapshotsForPlan -PlannedItems $Plan
        } finally {
            Remove-Item Function:\Test-Path -Force -ErrorAction SilentlyContinue
        }
    } $powerOnlyPlan)
    Assert-Equal $powerOnlySnapshots.Count 0 "A power-only backup must not access the display-adapter registry branch"

    $nvidiaPlan = @([PSCustomObject]@{ Category = "gpuOptimization"; Item = "nvidiaOptimize" })
    $requiredSnapshotError = ""
    try {
        $null = & $backupModule {
            param($Plan)
            function Test-Path { [CmdletBinding()] param([string]$LiteralPath) throw "Simulated protected registry access" }
            try {
                Get-GpuRegistryValueSnapshotsForPlan -PlannedItems $Plan
            } finally {
                Remove-Item Function:\Test-Path -Force -ErrorAction SilentlyContinue
            }
        } $nvidiaPlan
    } catch {
        $requiredSnapshotError = $_.Exception.Message
    }
    Assert-Match $requiredSnapshotError ".+" "A required GPU registry snapshot read failure must remain fatal"

    $displayClassPath = Join-Path $registryPath "DisplayClass"
    $nvidiaAdapterPath = Join-Path $displayClassPath "0000"
    $nestedNumericPath = Join-Path $nvidiaAdapterPath "0001"
    $amdAdapterPath = Join-Path $displayClassPath "0002"
    New-Item -Path $nvidiaAdapterPath -Force | Out-Null
    New-ItemProperty -LiteralPath $nvidiaAdapterPath -Name "DriverDesc" -Value "NVIDIA Test Adapter" -PropertyType String | Out-Null
    New-ItemProperty -LiteralPath $nvidiaAdapterPath -Name "PerfLevelSrc" -Value 4369 -PropertyType DWord | Out-Null
    New-Item -Path $nestedNumericPath -Force | Out-Null
    New-ItemProperty -LiteralPath $nestedNumericPath -Name "DriverDesc" -Value "NVIDIA Nested Driver Key" -PropertyType String | Out-Null
    New-ItemProperty -LiteralPath $nestedNumericPath -Name "PerfLevelSrc" -Value 1 -PropertyType DWord | Out-Null
    New-Item -Path $amdAdapterPath -Force | Out-Null
    New-ItemProperty -LiteralPath $amdAdapterPath -Name "DriverDesc" -Value "AMD Test Adapter" -PropertyType String | Out-Null
    New-ItemProperty -LiteralPath $amdAdapterPath -Name "GpuWorkload" -Value 1 -PropertyType DWord | Out-Null

    $gpuSnapshots = @(& $backupModule {
        param($Plan, $ClassPath)
        Get-GpuRegistryValueSnapshotsForPlan -PlannedItems $Plan -ClassPath $ClassPath
    } $nvidiaPlan $displayClassPath)
    Assert-Equal $gpuSnapshots.Count 5 "NVIDIA backup must snapshot exactly the five values that its optimization can write"
    Assert-Equal (@($gpuSnapshots | ForEach-Object { $_.Metadata.Path } | Select-Object -Unique) -join ",") $nvidiaAdapterPath "GPU backup must inspect only direct numeric adapter keys"
    Assert-Equal (@($gpuSnapshots | ForEach-Object { $_.Metadata.Name } | Sort-Object) -join ",") "EnableUlps,PerfLevelSrc,PowerMizerEnable,PowerMizerLevel,PowerMizerLevelAC" "GPU backup must stay within the existing registry whitelist"

    $amdPlan = @([PSCustomObject]@{ Category = "gpuOptimization"; Item = "amdOptimize" })
    $amdSnapshots = @(& $backupModule {
        param($Plan, $ClassPath)
        Get-GpuRegistryValueSnapshotsForPlan -PlannedItems $Plan -ClassPath $ClassPath
    } $amdPlan $displayClassPath)
    Assert-Equal $amdSnapshots.Count 2 "AMD backup must snapshot exactly the two values that its optimization can write"
    Assert-Equal (@($amdSnapshots | ForEach-Object { $_.Metadata.Path } | Select-Object -Unique) -join ",") $amdAdapterPath "AMD backup must target only the matching direct adapter key"
    Assert-Equal (@($amdSnapshots | ForEach-Object { $_.Metadata.Name } | Sort-Object) -join ",") "EnableUlps,GpuWorkload" "AMD backup must stay within the existing registry whitelist"

    $fullGpuSnapshots = @(& $backupModule {
        param($ClassPath)
        Get-GpuRegistryValueSnapshotsForPlan -FullBackup -ClassPath $ClassPath
    } $displayClassPath)
    Assert-Equal $fullGpuSnapshots.Count 7 "A standalone full backup must include both vendor-specific snapshot sets"

    $snapshotBackupDirectory = Join-Path $testRoot "backup_gpu_value_snapshots"
    [IO.Directory]::CreateDirectory($snapshotBackupDirectory) | Out-Null
    $snapshotManifest = [PSCustomObject][ordered]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        Kind = "PreApplyBackup"
        BackupId = "backup_gpu_value_snapshots"
        RegistryExports = @()
        RegistryValueSnapshots = @($gpuSnapshots)
        ServicesSnapshot = $null
        PowerScheme = $null
    }
    [IO.File]::WriteAllText(
        (Join-Path $snapshotBackupDirectory "backup_manifest.json"),
        ($snapshotManifest | ConvertTo-Json -Depth 8),
        (New-Object Text.UTF8Encoding($false))
    )
    $snapshotRestoreCalls = [System.Collections.ArrayList]::new()
    $snapshotRestoreResult = & $backupModule {
        param($BackupPath, $Calls)
        function Restore-RegistryChangeRecord {
            param($Change)
            $Calls.Add("$($Change.Metadata.Path)|$($Change.Metadata.Name)") | Out-Null
        }
        function Assert-TrustedBackupStorage { return $true }
        try {
            Restore-OptimizationBackup -BackupPath $BackupPath -SkipServices -SkipPower
        } finally {
            Remove-Item Function:\Restore-RegistryChangeRecord,Function:\Assert-TrustedBackupStorage -Force -ErrorAction SilentlyContinue
        }
    } $snapshotBackupDirectory $snapshotRestoreCalls
    Assert-Equal $snapshotRestoreResult.Success $true "A schema 2 backup with targeted registry snapshots must restore successfully"
    Assert-Equal $snapshotRestoreResult.RestoredCount 5 "Every targeted GPU registry value must be restored"
    Assert-Equal $snapshotRestoreCalls.Count 5 "Targeted snapshots must use the allowlisted registry restore path"

    $trustedStorage = & $backupModule {
        param($Directory)
        function Get-Acl {
            param([string]$LiteralPath)
            $adminSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
            return [PSCustomObject]@{
                Owner = $adminSid
                Access = @([PSCustomObject]@{
                    IdentityReference = $adminSid
                    AccessControlType = "Allow"
                    FileSystemRights = [System.Security.AccessControl.FileSystemRights]::FullControl
                })
            }
        }
        try { Assert-TrustedBackupStorage -BackupPath $Directory } finally { Remove-Item Function:\Get-Acl -Force -ErrorAction SilentlyContinue }
    } $backupDirectory
    Assert-Equal $trustedStorage $true "An administrator-owned backup directory with only trusted write access must pass storage validation"

    $untrustedStorageError = & $backupModule {
        param($Directory)
        function Get-Acl {
            param([string]$LiteralPath)
            $usersSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-545")
            return [PSCustomObject]@{
                Owner = $usersSid
                Access = @([PSCustomObject]@{
                    IdentityReference = $usersSid
                    AccessControlType = "Allow"
                    FileSystemRights = [System.Security.AccessControl.FileSystemRights]::FullControl
                })
            }
        }
        try { Assert-TrustedBackupStorage -BackupPath $Directory; return "" } catch { return $_.Exception.Message }
        finally { Remove-Item Function:\Get-Acl -Force -ErrorAction SilentlyContinue }
    } $backupDirectory
    Assert-Match $untrustedStorageError "trusted system principal|untrusted principal" "Untrusted backup storage must be rejected before privileged restore"

    Write-Output "Backup registry regression tests passed"
} finally {
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
        if (-not $resolvedTestRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove a test directory outside the system temporary directory" }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
