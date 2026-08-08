#Requires -Version 5.1

$ErrorActionPreference = "Stop"

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message (expected: $Expected; actual: $Actual)" }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Import-Module -Name (Join-Path $repositoryRoot "scripts\utils\NativeCommand.psm1") -Force
Import-Module -Name (Join-Path $repositoryRoot "scripts\utils\Backup.psm1") -Force

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

    $restoreResult = Restore-OptimizationBackup -BackupPath $backupDirectory -SkipServices -SkipPower
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
    $legacyResult = Restore-OptimizationBackup -BackupPath $backupDirectory -SkipServices -SkipPower
    Assert-Equal $legacyResult.Success $true "A legacy schema 2 registry backup must remain restorable"
    Assert-Equal (@((Get-Item -LiteralPath $registryPath).GetValueNames()) -contains "LegacyAdded") $true "A legacy backup without inventory must retain merge behavior"

    Write-Output "Backup registry regression tests passed"
} finally {
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
        if (-not $resolvedTestRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove a test directory outside the system temporary directory" }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
