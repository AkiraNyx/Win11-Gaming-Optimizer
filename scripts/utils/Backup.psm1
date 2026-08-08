#Requires -Version 5.1

Import-Module (Join-Path $PSScriptRoot "NativeCommand.psm1")
Import-Module (Join-Path $PSScriptRoot "RestorePoint.psm1")

function Write-BackupJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 8
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $tempPath = "$fullPath.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($tempPath, ($Value | ConvertTo-Json -Depth $Depth), $encoding)
        Move-Item -LiteralPath $tempPath -Destination $fullPath -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    }
}

function Save-BackupManifest {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Manifest)
    $Manifest.UpdatedAt = [DateTime]::UtcNow.ToString("o")
    Write-BackupJson -Path $Path -Value $Manifest
}

function Resolve-BackupChildPath {
    param([Parameter(Mandatory = $true)][string]$BackupDirectory, [Parameter(Mandatory = $true)][string]$RelativePath)

    $root = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath((Join-Path $BackupDirectory $RelativePath))
    if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Backup manifest contains a path outside its directory: $RelativePath"
    }
    return $candidate
}

function Get-RegistryValueInventory {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RegistryPath)

    $root = Get-Item -LiteralPath $RegistryPath -ErrorAction Stop
    $rootName = [string]$root.Name
    $keys = @($root) + @(Get-ChildItem -LiteralPath $RegistryPath -Recurse -ErrorAction Stop)
    return @($keys | ForEach-Object {
        [PSCustomObject]@{
            Key = ([string]$_.Name).Substring($rootName.Length).TrimStart('\')
            Values = @($_.GetValueNames())
        }
    })
}

function Remove-RegistryValuesNotInInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)]$ValueInventory
    )

    $inventoryByKey = @{}
    foreach ($keyInventory in @($ValueInventory)) {
        $savedValues = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($valueName in @($keyInventory.Values)) { $savedValues.Add([string]$valueName) | Out-Null }
        $inventoryByKey[[string]$keyInventory.Key] = $savedValues
    }
    if (-not $inventoryByKey.ContainsKey("")) { throw "Registry value inventory is missing its root key: $RegistryPath" }

    foreach ($currentKey in @(Get-RegistryValueInventory -RegistryPath $RegistryPath)) {
        $relativePath = [string]$currentKey.Key
        if ($inventoryByKey.ContainsKey($relativePath)) {
            $savedValues = $inventoryByKey[$relativePath]
        } else {
            $savedValues = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        }
        $keyPath = if ([string]::IsNullOrEmpty($relativePath)) { $RegistryPath } else { Join-Path $RegistryPath $relativePath }
        $nativePath = $keyPath -replace '^HKLM:\\', 'HKLM\' -replace '^HKCU:\\', 'HKCU\'
        foreach ($valueName in @($currentKey.Values)) {
            $valueName = [string]$valueName
            if ($savedValues.Contains($valueName)) { continue }
            $arguments = if ([string]::IsNullOrEmpty($valueName)) {
                @("delete", $nativePath, "/ve", "/f")
            } else {
                @("delete", $nativePath, "/v", $valueName, "/f")
            }
            Invoke-CheckedNativeCommand -FilePath "reg.exe" -ArgumentList $arguments | Out-Null
        }
    }
}

function New-OptimizationBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [string]$RestorePointDescription
    )

    $outputFullPath = [IO.Path]::GetFullPath($OutputDirectory)
    if (-not (Test-Path -LiteralPath $outputFullPath)) {
        New-Item -Path $outputFullPath -ItemType Directory -Force -ErrorAction Stop | Out-Null
    }

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupId = "backup_$timestamp"
    $backupDirectory = Join-Path $outputFullPath $backupId
    if (Test-Path -LiteralPath $backupDirectory) {
        $backupId = "$backupId`_$([guid]::NewGuid().ToString('N').Substring(0, 8))"
        $backupDirectory = Join-Path $outputFullPath $backupId
    }
    New-Item -Path $backupDirectory -ItemType Directory -ErrorAction Stop | Out-Null

    if (-not $RestorePointDescription) { $RestorePointDescription = "Win11Opt-PreApply-$timestamp" }
    $manifestPath = Join-Path $backupDirectory "backup_manifest.json"
    $errors = [System.Collections.ArrayList]::new()
    $warnings = [System.Collections.ArrayList]::new()
    $manifest = [PSCustomObject][ordered]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        Kind = "PreApplyBackup"
        BackupId = $backupId
        CreatedAt = [DateTime]::UtcNow.ToString("o")
        UpdatedAt = $null
        Status = "Creating"
        RestorePointSequenceNumber = $null
        RestorePointDescription = $RestorePointDescription
        RegistryExports = @()
        ServicesSnapshot = $null
        PowerScheme = $null
        DiagnosticSnapshots = @()
        Errors = @()
        Warnings = @()
    }
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    $restoreResult = New-OptimizationRestorePoint -Description $RestorePointDescription
    if ($restoreResult.Success) {
        $manifest.RestorePointSequenceNumber = $restoreResult.SequenceNumber
        $manifest.RestorePointDescription = $restoreResult.Description
    } else {
        $warnings.Add($restoreResult.Message) | Out-Null
    }
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    $registryPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\DeliveryOptimization",
        "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate",
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows",
        "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Power",
        "HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl",
        "HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl",
        "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}",
        "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces",
        "HKCU:\Control Panel\Desktop\WindowMetrics",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        "HKCU:\Software\Microsoft\GameBar",
        "HKCU:\System\GameConfigStore",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
    )

    $registryExports = [System.Collections.ArrayList]::new()
    $registryIndex = 0
    foreach ($path in $registryPaths) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $registryIndex++
        $fileName = "registry_{0:D2}.reg" -f $registryIndex
        $exportPath = Join-Path $backupDirectory $fileName
        $nativePath = $path -replace '^HKLM:\\', 'HKLM\' -replace '^HKCU:\\', 'HKCU\'
        try {
            $valueInventory = @(Get-RegistryValueInventory -RegistryPath $path)
            Invoke-CheckedNativeCommand -FilePath "reg.exe" -ArgumentList @("export", $nativePath, $exportPath, "/y") | Out-Null
            $registryExports.Add([PSCustomObject]@{ RegistryPath = $path; File = $fileName; ValueInventory = $valueInventory }) | Out-Null
        } catch {
            $errors.Add("Registry export failed for $path`: $($_.Exception.Message)") | Out-Null
        }
    }
    $manifest.RegistryExports = @($registryExports.ToArray())
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    try {
        $serviceFile = "services_snapshot.json"
        $services = Get-CimInstance Win32_Service -ErrorAction Stop | ForEach-Object {
            [PSCustomObject]@{
                Name = $_.Name
                DisplayName = $_.DisplayName
                State = $_.State
                StartMode = $_.StartMode
            }
        }
        Write-BackupJson -Path (Join-Path $backupDirectory $serviceFile) -Value @($services) -Depth 4
        $manifest.ServicesSnapshot = $serviceFile
    } catch {
        $errors.Add("Service snapshot failed: $($_.Exception.Message)") | Out-Null
    }
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    try {
        $activeResult = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
        $activeGuid = Get-GuidFromText -InputObject $activeResult.Output
        if (-not $activeGuid) { throw "The active power scheme GUID could not be parsed" }
        $powerFile = "active_power_scheme.pow"
        Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/export", (Join-Path $backupDirectory $powerFile), $activeGuid) | Out-Null
        $manifest.PowerScheme = [PSCustomObject]@{ ActiveGuid = $activeGuid; File = $powerFile }
    } catch {
        $errors.Add("Power scheme snapshot failed: $($_.Exception.Message)") | Out-Null
    }
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    $diagnosticSnapshots = [System.Collections.ArrayList]::new()
    $diagnostics = @(
        @{ File = "dns_snapshot.json"; Script = { Get-DnsClientServerAddress -ErrorAction Stop | Select-Object InterfaceIndex, InterfaceAlias, AddressFamily, ServerAddresses } },
        @{ File = "defender_snapshot.json"; Script = { Get-MpPreference -ErrorAction Stop | Select-Object ExclusionPath, ExclusionProcess, ScanScheduleDay, ScanScheduleQuickScanTime } },
        @{ File = "pagefile_snapshot.json"; Script = {
            [PSCustomObject]@{
                AutomaticManagedPagefile = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).AutomaticManagedPagefile
                Settings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | Select-Object Name, InitialSize, MaximumSize)
            }
        } },
        @{ File = "memory_snapshot.json"; Script = { Get-MMAgent -ErrorAction Stop | Select-Object MemoryCompression } }
    )
    foreach ($diagnostic in $diagnostics) {
        try {
            $value = & $diagnostic.Script
            Write-BackupJson -Path (Join-Path $backupDirectory $diagnostic.File) -Value $value -Depth 6
            $diagnosticSnapshots.Add($diagnostic.File) | Out-Null
        } catch {
            $warnings.Add("Optional snapshot $($diagnostic.File) failed: $($_.Exception.Message)") | Out-Null
        }
    }
    try {
        $bcd = Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/enum", "{current}")
        $bcd.Output | Out-File -LiteralPath (Join-Path $backupDirectory "bcd_current.txt") -Encoding UTF8
        $diagnosticSnapshots.Add("bcd_current.txt") | Out-Null
    } catch {
        $warnings.Add("Optional BCD snapshot failed: $($_.Exception.Message)") | Out-Null
    }

    $manifest.DiagnosticSnapshots = @($diagnosticSnapshots.ToArray())
    $manifest.Errors = @($errors.ToArray())
    $manifest.Warnings = @($warnings.ToArray())
    $manifest.Status = if ($errors.Count -eq 0) { "Completed" } else { "Failed" }
    Save-BackupManifest -Path $manifestPath -Manifest $manifest

    return [PSCustomObject]@{
        Success = ($errors.Count -eq 0)
        BackupId = $backupId
        BackupDirectory = $backupDirectory
        ManifestPath = $manifestPath
        RestorePointSequenceNumber = $manifest.RestorePointSequenceNumber
        RestorePointDescription = $manifest.RestorePointDescription
        Errors = @($errors.ToArray())
        Warnings = @($warnings.ToArray())
    }
}

function Read-OptimizationBackupManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$BackupPath)

    $backupDirectory = if (Test-Path -LiteralPath $BackupPath -PathType Container) {
        [IO.Path]::GetFullPath($BackupPath)
    } else {
        [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($BackupPath))
    }
    $manifestPath = if (Test-Path -LiteralPath $BackupPath -PathType Container) {
        Join-Path $backupDirectory "backup_manifest.json"
    } else {
        [IO.Path]::GetFullPath($BackupPath)
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Backup manifest was not found: $manifestPath" }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if ($manifest.Tool -ne "Win11Optimizer" -or [int]$manifest.SchemaVersion -lt 2 -or $manifest.Kind -ne "PreApplyBackup") {
        throw "Unsupported or untrusted backup manifest: $manifestPath"
    }
    if ((Split-Path -Leaf $backupDirectory) -ne $manifest.BackupId) {
        throw "Backup directory does not match the manifest backup ID"
    }
    return [PSCustomObject]@{ Directory = $backupDirectory; Path = $manifestPath; Manifest = $manifest }
}

function Restore-OptimizationBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [switch]$SkipRegistry,
        [switch]$SkipServices,
        [switch]$SkipPower
    )

    $backup = Read-OptimizationBackupManifest -BackupPath $BackupPath
    $errors = [System.Collections.ArrayList]::new()
    $restored = 0

    if (-not $SkipRegistry) {
        foreach ($entry in @($backup.Manifest.RegistryExports)) {
            try {
                $file = Resolve-BackupChildPath -BackupDirectory $backup.Directory -RelativePath ([string]$entry.File)
                if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing registry export: $($entry.File)" }
                Invoke-CheckedNativeCommand -FilePath "reg.exe" -ArgumentList @("import", $file) | Out-Null
                if ($entry.PSObject.Properties.Name -contains "ValueInventory") {
                    Remove-RegistryValuesNotInInventory -RegistryPath ([string]$entry.RegistryPath) -ValueInventory $entry.ValueInventory
                }
                $restored++
            } catch {
                $errors.Add($_.Exception.Message) | Out-Null
            }
        }
    }

    if (-not $SkipServices -and $backup.Manifest.ServicesSnapshot) {
        try {
            $servicePath = Resolve-BackupChildPath -BackupDirectory $backup.Directory -RelativePath ([string]$backup.Manifest.ServicesSnapshot)
            $services = Get-Content -LiteralPath $servicePath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
            foreach ($service in $services) {
                try {
                    $startupType = switch ([string]$service.StartMode) {
                        "Auto" { "Automatic" }
                        "Manual" { "Manual" }
                        "Disabled" { "Disabled" }
                        default { throw "Unsupported startup mode $($service.StartMode)" }
                    }
                    Set-Service -Name ([string]$service.Name) -StartupType $startupType -ErrorAction Stop
                    $restored++
                } catch {
                    $errors.Add("Service $($service.Name): $($_.Exception.Message)") | Out-Null
                }
            }
        } catch {
            $errors.Add("Service snapshot restore failed: $($_.Exception.Message)") | Out-Null
        }
    }

    if (-not $SkipPower -and $backup.Manifest.PowerScheme) {
        try {
            $powerFile = Resolve-BackupChildPath -BackupDirectory $backup.Directory -RelativePath ([string]$backup.Manifest.PowerScheme.File)
            if (-not (Test-Path -LiteralPath $powerFile -PathType Leaf)) { throw "Missing power scheme export" }
            $savedGuid = ([guid]([string]$backup.Manifest.PowerScheme.ActiveGuid)).ToString()
            $schemeList = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/list")
            $schemeText = (@($schemeList.Output) | ForEach-Object { $_.ToString() }) -join "`n"
            if ($schemeText -notmatch "(?i)\b$([regex]::Escape($savedGuid))\b") {
                Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/import", $powerFile, $savedGuid) | Out-Null
            }
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setactive", $savedGuid) | Out-Null
            $activeResult = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
            if ((Get-GuidFromText -InputObject $activeResult.Output) -ne $savedGuid) { throw "The saved power scheme was not activated" }
            $restored++
        } catch {
            $errors.Add("Power scheme restore failed: $($_.Exception.Message)") | Out-Null
        }
    }

    return [PSCustomObject]@{ Success = ($errors.Count -eq 0); Errors = @($errors.ToArray()); RestoredCount = $restored }
}

Export-ModuleMember -Function New-OptimizationBackup, Read-OptimizationBackupManifest, Restore-OptimizationBackup
