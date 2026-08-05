#Requires -Version 5.1

Import-Module (Join-Path $PSScriptRoot "NativeCommand.psm1")

$Script:TrackerDataKey = "Win11Optimizer.ChangeTracker.v2"

function New-OptimizationTrackerState {
    return [PSCustomObject]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        SessionId = $null
        CreatedAt = $null
        UpdatedAt = $null
        CompletedAt = $null
        RestoredAt = $null
        Status = "Uninitialized"
        JournalPath = $null
        JournalHealthy = $true
        JournalFailure = $null
        BackupPath = $null
        RestorePointSequenceNumber = $null
        RestorePointDescription = $null
        NextSequence = 1
        RegistryChanges = [System.Collections.ArrayList]::new()
        ServiceChanges = [System.Collections.ArrayList]::new()
        Operations = [System.Collections.ArrayList]::new()
        Errors = [System.Collections.ArrayList]::new()
    }
}

function Get-OptimizationTrackerState {
    $state = [AppDomain]::CurrentDomain.GetData($Script:TrackerDataKey)
    if ($null -eq $state -or $null -eq $state.PSObject.Properties["RegistryChanges"]) {
        $state = New-OptimizationTrackerState
        [AppDomain]::CurrentDomain.SetData($Script:TrackerDataKey, $state)
    } elseif ($null -eq $state.PSObject.Properties["JournalHealthy"]) {
        $state | Add-Member -NotePropertyName JournalHealthy -NotePropertyValue $true
        $state | Add-Member -NotePropertyName JournalFailure -NotePropertyValue $null
    }
    return $state
}

function Write-AtomicJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 10
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($fullPath)
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -Path $directory -ItemType Directory -Force -ErrorAction Stop | Out-Null
    }

    $tempPath = "$fullPath.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($tempPath, ($Value | ConvertTo-Json -Depth $Depth), $encoding)
        Move-Item -LiteralPath $tempPath -Destination $fullPath -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-OptimizationChangeManifest {
    $state = Get-OptimizationTrackerState
    $registryChanges = @($state.RegistryChanges.ToArray())
    $serviceChanges = @($state.ServiceChanges.ToArray())
    $operations = @($state.Operations.ToArray())

    return [PSCustomObject][ordered]@{
        SchemaVersion = $state.SchemaVersion
        Tool = $state.Tool
        SessionId = $state.SessionId
        CreatedAt = $state.CreatedAt
        UpdatedAt = $state.UpdatedAt
        CompletedAt = $state.CompletedAt
        RestoredAt = $state.RestoredAt
        Status = $state.Status
        BackupPath = $state.BackupPath
        RestorePointSequenceNumber = $state.RestorePointSequenceNumber
        RestorePointDescription = $state.RestorePointDescription
        ChangeCount = $registryChanges.Count + $serviceChanges.Count + $operations.Count
        RegistryChangeCount = $registryChanges.Count
        ServiceChangeCount = $serviceChanges.Count
        OperationCount = $operations.Count
        Changes = $registryChanges
        RegistryChanges = $registryChanges
        ServiceChanges = $serviceChanges
        Operations = $operations
        Errors = @($state.Errors.ToArray())
    }
}

function Save-OptimizationChangeJournal {
    [CmdletBinding()]
    param([string]$OutputPath)

    $state = Get-OptimizationTrackerState
    if ($OutputPath) { $state.JournalPath = [IO.Path]::GetFullPath($OutputPath) }
    if (-not $state.JournalPath) { return $null }
    if (-not [bool]$state.JournalHealthy) {
        throw "Change journal is unavailable after a prior write failure: $($state.JournalFailure)"
    }

    $state.UpdatedAt = [DateTime]::UtcNow.ToString("o")
    try {
        Write-AtomicJsonFile -Path $state.JournalPath -Value (Get-OptimizationChangeManifest)
    } catch {
        $state.JournalHealthy = $false
        $state.JournalFailure = $_.Exception.Message
        throw
    }
    return $state.JournalPath
}

function Test-OptimizationChangeJournalHealthy {
    return [bool](Get-OptimizationTrackerState).JournalHealthy
}

function Initialize-OptimizationChangeTracker {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [string]$SessionId = ([guid]::NewGuid().ToString("N"))
    )

    $state = Get-OptimizationTrackerState
    $state.RegistryChanges.Clear()
    $state.ServiceChanges.Clear()
    $state.Operations.Clear()
    $state.Errors.Clear()
    $state.SessionId = $SessionId
    $state.CreatedAt = [DateTime]::UtcNow.ToString("o")
    $state.UpdatedAt = $state.CreatedAt
    $state.CompletedAt = $null
    $state.RestoredAt = $null
    $state.Status = "Initializing"
    $state.JournalPath = [IO.Path]::GetFullPath($JournalPath)
    $state.JournalHealthy = $true
    $state.JournalFailure = $null
    $state.BackupPath = $null
    $state.RestorePointSequenceNumber = $null
    $state.RestorePointDescription = $null
    $state.NextSequence = 1
    Save-OptimizationChangeJournal | Out-Null
    return $state.SessionId
}

function Set-OptimizationChangeSession {
    [CmdletBinding()]
    param(
        [ValidateSet("Initializing","Ready","Applying","Completed","PartiallyFailed","BackupFailed","RestoreFailed","Restored")]
        [string]$Status,
        [AllowNull()][string]$BackupPath,
        [AllowNull()][Nullable[int]]$RestorePointSequenceNumber,
        [AllowNull()][string]$RestorePointDescription
    )

    $state = Get-OptimizationTrackerState
    if ($PSBoundParameters.ContainsKey("Status")) {
        $state.Status = $Status
        if ($Status -eq "Completed" -or $Status -eq "PartiallyFailed") {
            $state.CompletedAt = [DateTime]::UtcNow.ToString("o")
        }
        if ($Status -eq "Restored") { $state.RestoredAt = [DateTime]::UtcNow.ToString("o") }
    }
    if ($PSBoundParameters.ContainsKey("BackupPath")) { $state.BackupPath = $BackupPath }
    if ($PSBoundParameters.ContainsKey("RestorePointSequenceNumber")) { $state.RestorePointSequenceNumber = $RestorePointSequenceNumber }
    if ($PSBoundParameters.ContainsKey("RestorePointDescription")) { $state.RestorePointDescription = $RestorePointDescription }
    Save-OptimizationChangeJournal | Out-Null
}

function Clear-OptimizationTrackedChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][ValidateSet("Registry","Service","Operation")][string]$Collection)

    $state = Get-OptimizationTrackerState
    switch ($Collection) {
        "Registry" { $state.RegistryChanges.Clear() }
        "Service" { $state.ServiceChanges.Clear() }
        "Operation" { $state.Operations.Clear() }
    }
    Save-OptimizationChangeJournal | Out-Null
}

function Add-OptimizationSessionError {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Source = "Unknown"
    )

    $state = Get-OptimizationTrackerState
    $state.Errors.Add([PSCustomObject]@{
        Source = $Source
        Message = $Message
        Timestamp = [DateTime]::UtcNow.ToString("o")
    }) | Out-Null
    Save-OptimizationChangeJournal | Out-Null
}

function Add-TrackedChange {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("Registry","Service","Operation")][string]$Collection,
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Target,
        [AllowNull()]$OriginalValue,
        [AllowNull()]$NewValue,
        [bool]$OriginalExists = $true,
        [string]$Description = "",
        [AllowNull()]$Metadata
    )

    $state = Get-OptimizationTrackerState
    if (-not $state.JournalPath) { throw "Change tracker has not been initialized with a journal path" }

    $record = [PSCustomObject][ordered]@{
        Id = [guid]::NewGuid().ToString("N")
        Sequence = $state.NextSequence
        Kind = $Kind
        Target = $Target
        OriginalExists = $OriginalExists
        OriginalValue = $OriginalValue
        NewValue = $NewValue
        Description = $Description
        Metadata = $Metadata
        Status = "Pending"
        Error = $null
        Timestamp = [DateTime]::UtcNow.ToString("o")
    }
    $state.NextSequence++

    switch ($Collection) {
        "Registry" { $state.RegistryChanges.Add($record) | Out-Null }
        "Service" { $state.ServiceChanges.Add($record) | Out-Null }
        "Operation" { $state.Operations.Add($record) | Out-Null }
    }
    Save-OptimizationChangeJournal | Out-Null
    return $record.Id
}

function Add-RegistryChangeRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()]$OriginalValue,
        [AllowNull()]$NewValue,
        [bool]$OriginalExists,
        [string]$Description = "",
        [AllowNull()]$Metadata
    )
    return Add-TrackedChange -Collection Registry -Kind "RegistryValue" -Target "$Path|$Name" -OriginalValue $OriginalValue -NewValue $NewValue -OriginalExists $OriginalExists -Description $Description -Metadata $Metadata
}

function Add-ServiceChangeRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [AllowNull()]$OriginalValue,
        [AllowNull()]$NewValue,
        [string]$Description = "",
        [AllowNull()]$Metadata
    )
    return Add-TrackedChange -Collection Service -Kind "ServiceStartup" -Target $ServiceName -OriginalValue $OriginalValue -NewValue $NewValue -OriginalExists $true -Description $Description -Metadata $Metadata
}

function Register-OptimizationChange {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9]{0,63}$')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Target,
        [AllowNull()]$OriginalValue,
        [AllowNull()]$NewValue,
        [bool]$OriginalExists = $true,
        [string]$Description = "",
        [AllowNull()]$Metadata
    )
    return Add-TrackedChange -Collection Operation -Kind $Kind -Target $Target -OriginalValue $OriginalValue -NewValue $NewValue -OriginalExists $OriginalExists -Description $Description -Metadata $Metadata
}

function Set-OptimizationChangeResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][ValidateSet("Applied","Failed")][string]$Status,
        [string]$ErrorMessage
    )

    $state = Get-OptimizationTrackerState
    $record = @($state.RegistryChanges) + @($state.ServiceChanges) + @($state.Operations) |
        Where-Object { $_.Id -eq $Id } | Select-Object -First 1
    if (-not $record) { throw "Tracked change was not found: $Id" }
    $record.Status = $Status
    $record.Error = $ErrorMessage
    Save-OptimizationChangeJournal | Out-Null
}

function Get-TrackedRegistryChanges { return @((Get-OptimizationTrackerState).RegistryChanges.ToArray()) }
function Get-TrackedServiceChanges { return @((Get-OptimizationTrackerState).ServiceChanges.ToArray()) }
function Get-TrackedOperations { return @((Get-OptimizationTrackerState).Operations.ToArray()) }

function Read-OptimizationChangeManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Change manifest was not found: $Path" }
    $data = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if ($data.Tool -ne "Win11Optimizer" -or [int]$data.SchemaVersion -lt 2 -or -not $data.SessionId) {
        throw "Unsupported or untrusted change manifest: $Path"
    }
    return $data
}

function Set-OptimizationManifestStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet("RestoreFailed","Restored")][string]$Status,
        [string[]]$Errors = @()
    )

    $data = Read-OptimizationChangeManifest -Path $Path
    if ($Status -eq "Restored") {
        $restoreState = Get-OptimizationManifestRestoreState -Manifest $data
        if ($restoreState.UnrestoredCount -gt 0) {
            throw "Change manifest cannot be marked Restored while $($restoreState.UnrestoredCount) record(s) still require restore"
        }
    }
    $data.Status = $Status
    if ($Status -eq "Restored") {
        if ($null -eq $data.PSObject.Properties["RestoredAt"]) {
            $data | Add-Member -NotePropertyName RestoredAt -NotePropertyValue ([DateTime]::UtcNow.ToString("o"))
        } else {
            $data.RestoredAt = [DateTime]::UtcNow.ToString("o")
        }
    }
    if ($Errors.Count -gt 0) {
        $existing = @($data.Errors)
        $restoreErrors = @($Errors | ForEach-Object {
            [PSCustomObject]@{ Source = "Restore"; Message = $_; Timestamp = [DateTime]::UtcNow.ToString("o") }
        })
        $data.Errors = @($existing + $restoreErrors)
    }
    $data.UpdatedAt = [DateTime]::UtcNow.ToString("o")
    Write-AtomicJsonFile -Path $Path -Value $data
}

function Get-OptimizationManifestRecords {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][ValidateSet("Registry","Service","Operation")][string]$Collection
    )

    switch ($Collection) {
        "Registry" {
            if ($null -ne $Manifest.PSObject.Properties["RegistryChanges"]) { return @($Manifest.RegistryChanges) }
            if ($null -ne $Manifest.PSObject.Properties["Changes"]) { return @($Manifest.Changes) }
            return @()
        }
        "Service" {
            if ($null -ne $Manifest.PSObject.Properties["ServiceChanges"]) { return @($Manifest.ServiceChanges) }
            return @()
        }
        "Operation" {
            if ($null -ne $Manifest.PSObject.Properties["Operations"]) { return @($Manifest.Operations) }
            return @()
        }
    }
}

function Get-OptimizationManifestRestoreState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Manifest)

    $unrestoredCount = 0
    foreach ($collection in @("Registry", "Service", "Operation")) {
        $unrestoredCount += @(Get-OptimizationManifestRecords -Manifest $Manifest -Collection $collection |
            Where-Object { [string]$_.Status -ne "Restored" }).Count
    }

    $state = if ([string]$Manifest.Status -eq "Restored") {
        if ($unrestoredCount -eq 0) { "Restored" } else { "Inconsistent" }
    } else {
        "Restorable"
    }
    return [PSCustomObject]@{
        State = $state
        UnrestoredCount = $unrestoredCount
    }
}

function Set-OptimizationChangeRecordRestored {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet("Registry","Service","Operation")][string]$Collection,
        [Parameter(Mandatory = $true)][string]$Id
    )

    $data = Read-OptimizationChangeManifest -Path $Path
    $records = @(Get-OptimizationManifestRecords -Manifest $data -Collection $Collection)
    $matches = @($records | Where-Object { [string]$_.Id -eq $Id })
    if ($matches.Count -ne 1) {
        throw "Expected one $Collection change record with ID $Id, found $($matches.Count)"
    }

    $record = $matches[0]
    $restoredFromStatus = [string]$record.Status
    if (@("Pending", "Applied", "Failed") -notcontains $restoredFromStatus) {
        throw "$Collection change record $Id is not awaiting restore (status: $($record.Status))"
    }

    $record.Status = "Restored"
    $restoredAt = [DateTime]::UtcNow.ToString("o")
    if ($null -eq $record.PSObject.Properties["RestoredFromStatus"]) {
        $record | Add-Member -NotePropertyName RestoredFromStatus -NotePropertyValue $restoredFromStatus
    } else {
        $record.RestoredFromStatus = $restoredFromStatus
    }
    if ($null -eq $record.PSObject.Properties["RestoredAt"]) {
        $record | Add-Member -NotePropertyName RestoredAt -NotePropertyValue $restoredAt
    } else {
        $record.RestoredAt = $restoredAt
    }
    if ($null -eq $data.PSObject.Properties["UpdatedAt"]) {
        $data | Add-Member -NotePropertyName UpdatedAt -NotePropertyValue $restoredAt
    } else {
        $data.UpdatedAt = $restoredAt
    }

    if ($Collection -eq "Registry" -and
        $null -ne $data.PSObject.Properties["RegistryChanges"] -and
        $null -ne $data.PSObject.Properties["Changes"]) {
        $data.Changes = @($data.RegistryChanges)
    }

    Write-AtomicJsonFile -Path $Path -Value $data
}

function Invoke-TrackedRestoreRecords {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ChangesJsonPath,
        [Parameter(Mandatory = $true)][ValidateSet("Registry","Service","Operation")][string]$Collection,
        [Parameter(Mandatory = $true)][scriptblock]$RestoreAction,
        [string]$PriorityKind
    )

    $data = Read-OptimizationChangeManifest -Path $ChangesJsonPath
    $records = @(Get-OptimizationManifestRecords -Manifest $data -Collection $Collection)
    $candidates = @($records | Where-Object { @("Pending", "Applied", "Failed") -contains [string]$_.Status })

    $recordIds = @{}
    $allowedRecordStatuses = @("Pending", "Applied", "Failed", "Restored")
    foreach ($record in $records) {
        $recordId = [string]$record.Id
        if ([string]::IsNullOrWhiteSpace($recordId)) {
            throw "$Collection restore cannot start because a record has no ID"
        }
        if ($recordIds.ContainsKey($recordId)) {
            throw "$Collection restore cannot start because record ID $recordId is duplicated"
        }
        $recordIds[$recordId] = $true
        if ($allowedRecordStatuses -notcontains [string]$record.Status) {
            throw "$Collection restore cannot start because record $recordId has unsupported status $($record.Status)"
        }
    }

    $ordered = @()
    if ($PriorityKind) {
        $ordered += @($candidates | Where-Object { [string]$_.Kind -eq $PriorityKind } | Sort-Object Sequence -Descending)
        $ordered += @($candidates | Where-Object { [string]$_.Kind -ne $PriorityKind } | Sort-Object Sequence -Descending)
    } else {
        $ordered = @($candidates | Sort-Object Sequence -Descending)
    }

    $errors = [System.Collections.ArrayList]::new()
    $restoredCount = 0
    foreach ($record in $ordered) {
        $label = if ($Collection -eq "Operation") {
            "$([string]$record.Kind) [$([string]$record.Target)]"
        } else {
            [string]$record.Target
        }

        try {
            $null = & $RestoreAction $record
        } catch {
            $errors.Add("${label}: $($_.Exception.Message)") | Out-Null
            break
        }

        try {
            Set-OptimizationChangeRecordRestored -Path $ChangesJsonPath -Collection $Collection -Id ([string]$record.Id)
        } catch {
            throw "Restore journal update failed after ${label} was restored; remaining records were not processed: $($_.Exception.Message)"
        }
        $restoredCount++
    }

    return [PSCustomObject]@{
        Success = ($errors.Count -eq 0)
        Errors = @($errors.ToArray())
        RestoredCount = $restoredCount
    }
}

function Invoke-OptimizationManifestRestore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ChangesJsonPath,
        [Parameter(Mandatory = $true)][scriptblock]$RegistryRestoreAction,
        [Parameter(Mandatory = $true)][scriptblock]$ServiceRestoreAction
    )

    $data = Read-OptimizationChangeManifest -Path $ChangesJsonPath
    $entries = [System.Collections.ArrayList]::new()
    $recordIds = @{}
    $sequences = @{}
    $allowedStatuses = @("Pending", "Applied", "Failed", "Restored")
    foreach ($collection in @("Registry", "Service", "Operation")) {
        foreach ($record in @(Get-OptimizationManifestRecords -Manifest $data -Collection $collection)) {
            $recordId = [string]$record.Id
            if ([string]::IsNullOrWhiteSpace($recordId)) {
                throw "Manifest restore cannot start because a $Collection record has no ID"
            }
            if ($recordIds.ContainsKey($recordId)) {
                throw "Manifest restore cannot start because record ID $recordId is duplicated"
            }
            $recordIds[$recordId] = $true
            if ($allowedStatuses -notcontains [string]$record.Status) {
                throw "Manifest restore cannot start because record $recordId has unsupported status $($record.Status)"
            }
            $sequence = 0
            if (-not [int]::TryParse([string]$record.Sequence, [ref]$sequence) -or $sequence -lt 1) {
                throw "Manifest restore cannot start because record $recordId has an invalid sequence"
            }
            if ($sequences.ContainsKey($sequence)) {
                throw "Manifest restore cannot start because sequence $sequence is duplicated"
            }
            $sequences[$sequence] = $true
            if ([string]$record.Status -ne "Restored") {
                $entries.Add([PSCustomObject]@{ Collection = $collection; Record = $record; Sequence = $sequence }) | Out-Null
            }
        }
    }

    $errors = [System.Collections.ArrayList]::new()
    $restoredCount = 0
    $ordered = @($entries.ToArray() | Sort-Object Sequence -Descending)
    foreach ($entry in $ordered) {
        $record = $entry.Record
        $label = if ($entry.Collection -eq "Operation") {
            "$([string]$record.Kind) [$([string]$record.Target)]"
        } else {
            [string]$record.Target
        }
        try {
            switch ($entry.Collection) {
                "Registry" { $null = & $RegistryRestoreAction $record }
                "Service" { $null = & $ServiceRestoreAction $record }
                "Operation" { $null = Invoke-OperationRestore -Operation $record }
            }
        } catch {
            $errors.Add("${label}: $($_.Exception.Message)") | Out-Null
            break
        }

        try {
            Set-OptimizationChangeRecordRestored -Path $ChangesJsonPath -Collection $entry.Collection -Id ([string]$record.Id)
        } catch {
            throw "Restore journal update failed after ${label} was restored; remaining records were not processed: $($_.Exception.Message)"
        }
        $restoredCount++
    }

    return [PSCustomObject]@{
        Success = ($errors.Count -eq 0)
        Errors = @($errors.ToArray())
        RestoredCount = $restoredCount
        DeferredCount = $ordered.Count - $restoredCount - $errors.Count
    }
}

function Invoke-OperationRestore {
    param([Parameter(Mandatory = $true)]$Operation)

    switch ($Operation.Kind) {
        "PowerActiveScheme" {
            $guid = [string]$Operation.OriginalValue
            if ($guid -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "Invalid saved power scheme GUID" }
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setactive", $guid) | Out-Null
            $active = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
            if ((Get-GuidFromText -InputObject $active.Output) -ne $guid.ToLowerInvariant()) {
                throw "Power scheme verification failed after restore: $guid"
            }
        }
        "PowerSchemeCreated" {
            if (-not [bool]$Operation.OriginalExists) {
                $guid = [string]$Operation.Target
                if ($guid -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "Invalid created power scheme GUID" }
                $list = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/list")
                $listText = (@($list.Output) | ForEach-Object { $_.ToString() }) -join "`n"
                if ($listText -match [regex]::Escape($guid)) {
                    $active = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/getactivescheme")
                    if ((Get-GuidFromText -InputObject $active.Output) -eq $guid.ToLowerInvariant()) {
                        throw "Cannot delete the optimizer power scheme while it is active"
                    }
                    Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/delete", $guid) | Out-Null
                    $updatedList = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/list")
                    $updatedText = (@($updatedList.Output) | ForEach-Object { $_.ToString() }) -join "`n"
                    if ($updatedText -match [regex]::Escape($guid)) {
                        throw "Power scheme still exists after restore deletion: $guid"
                    }
                }
            }
        }
        "PowerSetting" {
            $meta = $Operation.Metadata
            $scheme = [string]$meta.SchemeGuid
            $subgroup = [string]$meta.SubgroupGuid
            $setting = [string]$meta.SettingGuid
            foreach ($value in @($scheme, $subgroup, $setting)) {
                if ($value -notmatch '^[A-Za-z0-9_-]+$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "Invalid power setting identifier" }
            }
            if ($null -ne $Operation.OriginalValue.AC) {
                Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setacvalueindex", $scheme, $subgroup, $setting, [string]$Operation.OriginalValue.AC) | Out-Null
            }
            if ($null -ne $Operation.OriginalValue.DC) {
                Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/setdcvalueindex", $scheme, $subgroup, $setting, [string]$Operation.OriginalValue.DC) | Out-Null
            }
            $updated = Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/query", $scheme, $subgroup, $setting)
            $updatedText = (@($updated.Output) | ForEach-Object { $_.ToString() }) -join "`n"
            $indexes = [regex]::Matches($updatedText, '(?i)0x([0-9a-f]{8})')
            if ($indexes.Count -lt 2) { throw "Unable to verify restored power setting: $setting" }
            $updatedAc = [Convert]::ToUInt32($indexes[$indexes.Count - 2].Groups[1].Value, 16)
            $updatedDc = [Convert]::ToUInt32($indexes[$indexes.Count - 1].Groups[1].Value, 16)
            if (($null -ne $Operation.OriginalValue.AC -and $updatedAc -ne [uint32]$Operation.OriginalValue.AC) -or
                ($null -ne $Operation.OriginalValue.DC -and $updatedDc -ne [uint32]$Operation.OriginalValue.DC)) {
                throw "Power setting verification failed after restore: $setting"
            }
        }
        "DnsServers" {
            $interfaceIndex = [int]$Operation.Target
            if ([bool]$Operation.Metadata.WasAutomatic) {
                Set-DnsClientServerAddress -InterfaceIndex $interfaceIndex -ResetServerAddresses -ErrorAction Stop
            } else {
                Set-DnsClientServerAddress -InterfaceIndex $interfaceIndex -ServerAddresses @($Operation.OriginalValue) -ErrorAction Stop
            }
        }
        "DefenderExclusionPath" {
            if (-not [bool]$Operation.OriginalExists) {
                $target = [string]$Operation.Target
                $existing = @((Get-MpPreference -ErrorAction Stop).ExclusionPath)
                if (@($existing | Where-Object { $_ -and $_.TrimEnd('\') -ieq $target.TrimEnd('\') }).Count -gt 0) {
                    Remove-MpPreference -ExclusionPath $target -ErrorAction Stop
                }
                $updated = @((Get-MpPreference -ErrorAction Stop).ExclusionPath)
                if (@($updated | Where-Object { $_ -and $_.TrimEnd('\') -ieq $target.TrimEnd('\') }).Count -gt 0) {
                    throw "Defender exclusion path still exists after restore: $target"
                }
            }
        }
        "DefenderExclusionProcess" {
            if (-not [bool]$Operation.OriginalExists) {
                $target = [string]$Operation.Target
                $existing = @((Get-MpPreference -ErrorAction Stop).ExclusionProcess)
                if (@($existing | Where-Object { $_ -ieq $target }).Count -gt 0) {
                    Remove-MpPreference -ExclusionProcess $target -ErrorAction Stop
                }
                $updated = @((Get-MpPreference -ErrorAction Stop).ExclusionProcess)
                if (@($updated | Where-Object { $_ -ieq $target }).Count -gt 0) {
                    throw "Defender exclusion process still exists after restore: $target"
                }
            }
        }
        "DefenderPreference" {
            switch ([string]$Operation.Target) {
                "ScanScheduleDay" { Set-MpPreference -ScanScheduleDay ([int]$Operation.OriginalValue) -ErrorAction Stop }
                "ScanScheduleQuickScanTime" { Set-MpPreference -ScanScheduleQuickScanTime ([int]$Operation.OriginalValue) -ErrorAction Stop }
                "ScanOnlyIfIdleEnabled" { Set-MpPreference -ScanOnlyIfIdleEnabled ([bool]$Operation.OriginalValue) -ErrorAction Stop }
                default { throw "Unsupported Defender preference: $($Operation.Target)" }
            }
            $updated = Get-MpPreference -ErrorAction Stop
            $updatedProperty = $updated.PSObject.Properties[[string]$Operation.Target]
            if ($null -eq $updatedProperty -or $updatedProperty.Value -ne $Operation.OriginalValue) {
                throw "Defender preference verification failed after restore: $($Operation.Target)"
            }
        }
        "BcdElement" {
            $element = [string]$Operation.Target
            $identifier = [string]$Operation.Metadata.Identifier
            $allowedElements = @("bootlog","timeout","numproc","useplatformtick","disabledynamictick","useplatformclock","nx")
            if ($allowedElements -notcontains $element -or $identifier -notmatch '^\{(current|bootmgr)\}$') {
                throw "Unsupported BCD target: $identifier $element"
            }
            if ([bool]$Operation.OriginalExists) {
                Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/set", $identifier, $element, [string]$Operation.OriginalValue) | Out-Null
            } else {
                $current = Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/enum", $identifier)
                $currentText = (@($current.Output) | ForEach-Object { $_.ToString() }) -join "`n"
                if ($currentText -match "(?im)^\s*$([regex]::Escape($element))\s+") {
                    Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/deletevalue", $identifier, $element) | Out-Null
                }
            }
            $updated = Invoke-CheckedNativeCommand -FilePath "bcdedit.exe" -ArgumentList @("/enum", $identifier)
            $updatedText = (@($updated.Output) | ForEach-Object { $_.ToString() }) -join "`n"
            $pattern = "(?im)^\s*$([regex]::Escape($element))\s+(.+?)\s*$"
            $updatedMatch = [regex]::Match($updatedText, $pattern)
            if ([bool]$Operation.OriginalExists) {
                if (-not $updatedMatch.Success -or -not [string]::Equals($updatedMatch.Groups[1].Value, [string]$Operation.OriginalValue, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "BCD element verification failed after restore: $identifier $element"
                }
            } elseif ($updatedMatch.Success) {
                throw "BCD element still exists after restore: $identifier $element"
            }
        }
        "FsutilBehavior" {
            $behavior = [string]$Operation.Target
            $fileSystem = [string]$Operation.Metadata.FileSystem
            if ($behavior -match '^(?i)DisableDeleteNotify:(NTFS|ReFS)$') {
                $behavior = "DisableDeleteNotify"
                $targetFileSystem = $Matches[1]
                if ($fileSystem -and -not [string]::Equals($fileSystem, $targetFileSystem, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Fsutil target and metadata file-system qualifiers do not match"
                }
                $fileSystem = $targetFileSystem
            }
            if (@("disablelastaccess","disable8dot3","DisableDeleteNotify") -notcontains $behavior) {
                throw "Unsupported fsutil behavior: $behavior"
            }
            if ($fileSystem -and ($behavior -ine "DisableDeleteNotify" -or @("NTFS", "ReFS") -notcontains $fileSystem)) {
                throw "Unsupported fsutil file-system qualifier: $fileSystem"
            }
            $arguments = @("behavior", "set", $behavior)
            if ($fileSystem) { $arguments += $fileSystem }
            $arguments += [string]$Operation.OriginalValue
            Invoke-CheckedNativeCommand -FilePath "fsutil.exe" -ArgumentList $arguments | Out-Null
            $queryArguments = @("behavior", "query", $behavior)
            if ($fileSystem) { $queryArguments += $fileSystem }
            $queryResult = Invoke-CheckedNativeCommand -FilePath "fsutil.exe" -ArgumentList $queryArguments
            $queryText = (@($queryResult.Output) | ForEach-Object { $_.ToString() }) -join "`n"
            if ($queryText -notmatch '=\s*(\d+)' -or [int]$Matches[1] -ne [int]$Operation.OriginalValue) {
                throw "Fsutil behavior verification failed after restore: $($Operation.Target)"
            }
        }
        "Hibernation" {
            $mode = if ([bool]$Operation.OriginalValue) { "on" } else { "off" }
            Invoke-CheckedNativeCommand -FilePath "powercfg.exe" -ArgumentList @("/hibernate", $mode) | Out-Null
            $updated = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "HibernateEnabled" -ErrorAction Stop
            if (([int]$updated.HibernateEnabled -ne 0) -ne [bool]$Operation.OriginalValue) {
                throw "Hibernation verification failed after restore"
            }
        }
        "MemoryCompression" {
            if ([bool]$Operation.OriginalValue) { Enable-MMAgent -MemoryCompression -ErrorAction Stop }
            else { Disable-MMAgent -MemoryCompression -ErrorAction Stop }
            if ([bool](Get-MMAgent -ErrorAction Stop).MemoryCompression -ne [bool]$Operation.OriginalValue) {
                throw "Memory compression verification failed after restore"
            }
        }
        "NicPowerManagement" {
            $allowedProperties = @("ArpOffload", "D0PacketCoalescing", "DeviceSleepOnDisconnect", "NSOffload", "RsnRekeyOffload", "SelectiveSuspend", "WakeOnMagicPacket", "WakeOnPattern")
            $parameters = @{ Name = [string]$Operation.Target; ErrorAction = "Stop" }
            foreach ($propertyName in $allowedProperties) {
                $property = $Operation.OriginalValue.PSObject.Properties[$propertyName]
                if ($null -ne $property -and @("Enabled", "Disabled") -contains [string]$property.Value) {
                    $parameters[$propertyName] = [string]$property.Value
                }
            }
            if ($parameters.Count -le 2) { throw "No restorable adapter power settings were recorded" }
            Set-NetAdapterPowerManagement @parameters
            $updated = Get-NetAdapterPowerManagement -Name ([string]$Operation.Target) -ErrorAction Stop
            foreach ($propertyName in $allowedProperties) {
                if (-not $parameters.ContainsKey($propertyName)) { continue }
                if ([string]$updated.PSObject.Properties[$propertyName].Value -ne [string]$parameters[$propertyName]) {
                    throw "Adapter power setting verification failed after restore: $($Operation.Target) $propertyName"
                }
            }
        }
        "PageFileConfiguration" {
            $original = $Operation.OriginalValue
            $computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
            $computerSystem | Set-CimInstance -Property @{ AutomaticManagedPagefile = [bool]$original.AutomaticManagedPagefile } -ErrorAction Stop | Out-Null
            if (-not [bool]$original.AutomaticManagedPagefile) {
                foreach ($setting in @($original.Settings)) {
                    $existing = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue |
                        Where-Object { $_.Name -eq [string]$setting.Name } | Select-Object -First 1
                    if ($existing) {
                        $existing | Set-CimInstance -Property @{ InitialSize = [uint32]$setting.InitialSize; MaximumSize = [uint32]$setting.MaximumSize } -ErrorAction Stop | Out-Null
                    } else {
                        New-CimInstance Win32_PageFileSetting -Property @{ Name = [string]$setting.Name; InitialSize = [uint32]$setting.InitialSize; MaximumSize = [uint32]$setting.MaximumSize } -ErrorAction Stop | Out-Null
                    }
                }
            }
            $updatedSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
            if ([bool]$updatedSystem.AutomaticManagedPagefile -ne [bool]$original.AutomaticManagedPagefile) {
                throw "Page file management verification failed after restore"
            }
            if (-not [bool]$original.AutomaticManagedPagefile) {
                $updatedSettings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)
                foreach ($setting in @($original.Settings)) {
                    $updatedSetting = $updatedSettings | Where-Object { $_.Name -eq [string]$setting.Name } | Select-Object -First 1
                    if (-not $updatedSetting -or [uint32]$updatedSetting.InitialSize -ne [uint32]$setting.InitialSize -or [uint32]$updatedSetting.MaximumSize -ne [uint32]$setting.MaximumSize) {
                        throw "Page file setting verification failed after restore: $($setting.Name)"
                    }
                }
            }
        }
        default { throw "Unsupported tracked operation kind: $($Operation.Kind)" }
    }
}

function Restore-OptimizationStateChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ChangesJsonPath)

    return Invoke-TrackedRestoreRecords -ChangesJsonPath $ChangesJsonPath -Collection Operation -PriorityKind "PowerActiveScheme" -RestoreAction {
        param($operation)
        Invoke-OperationRestore -Operation $operation
    }
}

Export-ModuleMember -Function Initialize-OptimizationChangeTracker, Set-OptimizationChangeSession, Clear-OptimizationTrackedChanges, Add-OptimizationSessionError, Save-OptimizationChangeJournal, Test-OptimizationChangeJournalHealthy, Get-OptimizationChangeManifest, Add-RegistryChangeRecord, Add-ServiceChangeRecord, Register-OptimizationChange, Set-OptimizationChangeResult, Get-TrackedRegistryChanges, Get-TrackedServiceChanges, Get-TrackedOperations, Read-OptimizationChangeManifest, Get-OptimizationManifestRestoreState, Set-OptimizationManifestStatus, Set-OptimizationChangeRecordRestored, Invoke-TrackedRestoreRecords, Invoke-OptimizationManifestRestore, Restore-OptimizationStateChanges
