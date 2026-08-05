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
        throw "$Message (value: $Actual)"
    }
}

function New-TestRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][int]$Sequence,
        [string]$Kind = "TestOperation",
        [string]$Target = "TestTarget",
        [Parameter(Mandatory = $true)][string]$Status,
        [bool]$OriginalExists = $true,
        [AllowNull()]$OriginalValue = "before",
        [AllowNull()]$Metadata = $null
    )

    return [PSCustomObject][ordered]@{
        Id = $Id
        Sequence = $Sequence
        Kind = $Kind
        Target = $Target
        OriginalExists = $OriginalExists
        OriginalValue = $OriginalValue
        NewValue = "after"
        Description = "Restore retry regression record"
        Metadata = $Metadata
        Status = $Status
        Error = $null
        Timestamp = [DateTime]::UtcNow.ToString("o")
    }
}

function New-TestManifest {
    param(
        [object[]]$RegistryChanges = @(),
        [object[]]$ServiceChanges = @(),
        [object[]]$Operations = @()
    )

    return [PSCustomObject][ordered]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        SessionId = [guid]::NewGuid().ToString("N")
        CreatedAt = [DateTime]::UtcNow.ToString("o")
        UpdatedAt = [DateTime]::UtcNow.ToString("o")
        CompletedAt = [DateTime]::UtcNow.ToString("o")
        RestoredAt = $null
        Status = "Completed"
        BackupPath = $null
        RestorePointSequenceNumber = $null
        RestorePointDescription = $null
        ChangeCount = $RegistryChanges.Count + $ServiceChanges.Count + $Operations.Count
        RegistryChangeCount = $RegistryChanges.Count
        ServiceChangeCount = $ServiceChanges.Count
        OperationCount = $Operations.Count
        Changes = @($RegistryChanges)
        RegistryChanges = @($RegistryChanges)
        ServiceChanges = @($ServiceChanges)
        Operations = @($Operations)
        Errors = @()
    }
}

function Write-TestManifest {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Manifest)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, ($Manifest | ConvertTo-Json -Depth 10), $encoding)
}

function Get-RecordStatus {
    param($Manifest, [Parameter(Mandatory = $true)][string]$Collection, [Parameter(Mandatory = $true)][string]$Id)
    return [string](@($Manifest.$Collection | Where-Object { [string]$_.Id -eq $Id })[0].Status)
}

function Get-RecordProperty {
    param(
        $Manifest,
        [Parameter(Mandatory = $true)][string]$Collection,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Property
    )
    return @($Manifest.$Collection | Where-Object { [string]$_.Id -eq $Id })[0].$Property
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$utilsPath = Join-Path $repositoryRoot "scripts\utils"
Import-Module -Name (Join-Path $utilsPath "ChangeTracking.psm1") -Force
Import-Module -Name (Join-Path $utilsPath "NativeCommand.psm1") -Force
Import-Module -Name (Join-Path $utilsPath "Registry.psm1") -Force
Import-Module -Name (Join-Path $utilsPath "RestorePoint.psm1") -Force
Import-Module -Name (Join-Path $utilsPath "Service.psm1") -Force
Import-Module -Name (Join-Path $utilsPath "Backup.psm1") -Force

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("Win11OptRestoreTests_" + [guid]::NewGuid().ToString("N"))))
if (-not $testRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved test directory is outside the system temporary directory"
}
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

try {
    $operationsPath = Join-Path $testRoot "operations.json"
    $operations = @(
        (New-TestRecord -Id "op-older" -Sequence 1 -Status "Applied"),
        (New-TestRecord -Id "op-fail" -Sequence 2 -Status "Applied"),
        (New-TestRecord -Id "op-newer-success" -Sequence 3 -Status "Applied"),
        (New-TestRecord -Id "op-already-restored" -Sequence 4 -Status "Restored")
    )
    Write-TestManifest -Path $operationsPath -Manifest (New-TestManifest -Operations $operations)

    $firstAttempts = [System.Collections.ArrayList]::new()
    $firstAction = {
        param($record)
        $firstAttempts.Add([string]$record.Id) | Out-Null
        if ([string]$record.Id -eq "op-fail") { throw "simulated restore failure" }
    }.GetNewClosure()
    $firstResult = Invoke-TrackedRestoreRecords -ChangesJsonPath $operationsPath -Collection Operation -RestoreAction $firstAction
    Assert-Equal $firstResult.Success $false "A failed record must make the restore result unsuccessful"
    Assert-Equal $firstResult.RestoredCount 1 "Exactly one operation should be restored and journaled"
    Assert-Equal $firstResult.Errors.Count 1 "Exactly one operation error should be returned"
    Assert-Equal (($firstAttempts.ToArray()) -join ",") "op-newer-success,op-fail" "Restore must stop at the first failure to preserve reverse sequence order"

    $afterFirst = Read-OptimizationChangeManifest -Path $operationsPath
    Assert-Equal (Get-RecordStatus $afterFirst "Operations" "op-newer-success") "Restored" "Successful operations must be persisted as Restored"
    Assert-Equal (Get-RecordStatus $afterFirst "Operations" "op-fail") "Applied" "Failed operations must remain Applied"
    Assert-Equal (Get-RecordStatus $afterFirst "Operations" "op-older") "Applied" "Older operations must remain Applied after a newer restore fails"
    Assert-Equal (Get-RecordStatus $afterFirst "Operations" "op-already-restored") "Restored" "Previously restored operations must remain Restored"

    $manifestGuardError = ""
    try { Set-OptimizationManifestStatus -Path $operationsPath -Status Restored } catch { $manifestGuardError = $_.Exception.Message }
    Assert-Match $manifestGuardError "still require restore" "A manifest with retryable records must not be marked Restored"

    $retryAttempts = [System.Collections.ArrayList]::new()
    $retryAction = { param($record) $retryAttempts.Add([string]$record.Id) | Out-Null }.GetNewClosure()
    $retryResult = Invoke-TrackedRestoreRecords -ChangesJsonPath $operationsPath -Collection Operation -RestoreAction $retryAction
    Assert-Equal $retryResult.Success $true "The retry should succeed"
    Assert-Equal $retryResult.RestoredCount 2 "The retry should restore the prior failure and then continue with older records"
    Assert-Equal (($retryAttempts.ToArray()) -join ",") "op-fail,op-older" "The retry must resume in reverse order without replaying restored operations"
    Set-OptimizationManifestStatus -Path $operationsPath -Status Restored
    Assert-Equal ([string](Read-OptimizationChangeManifest -Path $operationsPath).Status) "Restored" "The completed manifest should be marked Restored"

    $thirdAttempts = [System.Collections.ArrayList]::new()
    $thirdAction = { param($record) $thirdAttempts.Add([string]$record.Id) | Out-Null }.GetNewClosure()
    $thirdResult = Invoke-TrackedRestoreRecords -ChangesJsonPath $operationsPath -Collection Operation -RestoreAction $thirdAction
    Assert-Equal $thirdResult.RestoredCount 0 "A completed retry must be idempotent"
    Assert-Equal $thirdAttempts.Count 0 "No Restored operation may be replayed"

    $registryPath = Join-Path $testRoot "registry.json"
    $registryRecord = New-TestRecord -Id "registry-success" -Sequence 1 -Kind "RegistryValue" -Target "test|value" -Status "Applied"
    Write-TestManifest -Path $registryPath -Manifest (New-TestManifest -RegistryChanges @($registryRecord))
    $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $registryPath -Collection Registry -RestoreAction { param($record) }
    $registryAfter = Read-OptimizationChangeManifest -Path $registryPath
    Assert-Equal (Get-RecordStatus $registryAfter "RegistryChanges" "registry-success") "Restored" "RegistryChanges must persist Restored status"
    Assert-Equal (Get-RecordStatus $registryAfter "Changes" "registry-success") "Restored" "The legacy Changes alias must stay synchronized"

    $servicePath = Join-Path $testRoot "service.json"
    $serviceRecord = New-TestRecord -Id "service-success" -Sequence 1 -Kind "ServiceStartup" -Target "test-service" -Status "Applied"
    Write-TestManifest -Path $servicePath -Manifest (New-TestManifest -ServiceChanges @($serviceRecord))
    $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $servicePath -Collection Service -RestoreAction { param($record) }
    $serviceAfter = Read-OptimizationChangeManifest -Path $servicePath
    Assert-Equal (Get-RecordStatus $serviceAfter "ServiceChanges" "service-success") "Restored" "ServiceChanges must persist Restored status"

    $globalPath = Join-Path $testRoot "global-order.json"
    Write-TestManifest -Path $globalPath -Manifest (New-TestManifest `
        -RegistryChanges @((New-TestRecord -Id "global-registry" -Sequence 3 -Kind "RegistryValue" -Status "Pending")) `
        -ServiceChanges @((New-TestRecord -Id "global-service" -Sequence 1 -Kind "ServiceStartup" -Status "Applied")) `
        -Operations @((New-TestRecord -Id "global-operation" -Sequence 2 -Kind "PowerSchemeCreated" -Status "Failed")))
    $globalAttempts = [System.Collections.ArrayList]::new()
    $globalResult = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalPath `
        -RegistryRestoreAction { param($record) $globalAttempts.Add("registry") | Out-Null } `
        -ServiceRestoreAction {
            param($record)
            $duringService = Read-OptimizationChangeManifest -Path $globalPath
            $globalAttempts.Add("service:$((Get-RecordStatus $duringService 'RegistryChanges' 'global-registry')):$((Get-RecordStatus $duringService 'Operations' 'global-operation'))") | Out-Null
        }
    Assert-Equal $globalResult.Success $true "A mixed manifest should restore successfully"
    Assert-Equal $globalResult.RestoredCount 3 "Every mixed-state record should be restored"
    Assert-Equal (($globalAttempts.ToArray()) -join ",") "registry,service:Restored:Restored" "Mixed collections must restore in global reverse sequence order"
    $globalAfter = Read-OptimizationChangeManifest -Path $globalPath
    Assert-Equal ([string](Get-RecordProperty $globalAfter "RegistryChanges" "global-registry" "RestoredFromStatus")) "Pending" "Pending provenance must be persisted"
    Assert-Equal ([string](Get-RecordProperty $globalAfter "Operations" "global-operation" "RestoredFromStatus")) "Failed" "Failed provenance must be persisted"
    Assert-Equal ([string](Get-RecordProperty $globalAfter "ServiceChanges" "global-service" "RestoredFromStatus")) "Applied" "Applied provenance must be persisted"

    $globalFailurePath = Join-Path $testRoot "global-failure.json"
    Write-TestManifest -Path $globalFailurePath -Manifest (New-TestManifest `
        -RegistryChanges @((New-TestRecord -Id "failure-registry" -Sequence 3 -Kind "RegistryValue" -Status "Pending")) `
        -ServiceChanges @((New-TestRecord -Id "failure-service" -Sequence 2 -Kind "ServiceStartup" -Status "Failed")) `
        -Operations @((New-TestRecord -Id "failure-operation" -Sequence 1 -Kind "PowerSchemeCreated" -Status "Applied")))
    $globalFailureAttempts = [System.Collections.ArrayList]::new()
    $globalFailureResult = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalFailurePath `
        -RegistryRestoreAction { param($record) $globalFailureAttempts.Add("registry") | Out-Null } `
        -ServiceRestoreAction { param($record) $globalFailureAttempts.Add("service") | Out-Null; throw "simulated mixed restore failure" }
    Assert-Equal $globalFailureResult.Success $false "A cross-collection failure must fail the restore"
    Assert-Equal $globalFailureResult.RestoredCount 1 "Only newer cross-collection records may be restored before failure"
    Assert-Equal $globalFailureResult.DeferredCount 1 "Older cross-collection records must be deferred"
    Assert-Equal (($globalFailureAttempts.ToArray()) -join ",") "registry,service" "Restore must stop at the first cross-collection failure"
    $globalFailureAfter = Read-OptimizationChangeManifest -Path $globalFailurePath
    Assert-Equal (Get-RecordStatus $globalFailureAfter "RegistryChanges" "failure-registry") "Restored" "Newer records must remain journaled after a later failure"
    Assert-Equal (Get-RecordStatus $globalFailureAfter "ServiceChanges" "failure-service") "Failed" "The failed record must remain retryable"
    Assert-Equal (Get-RecordStatus $globalFailureAfter "Operations" "failure-operation") "Applied" "Older records must remain untouched after failure"
    $globalRetryAttempts = [System.Collections.ArrayList]::new()
    $globalRetryResult = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalFailurePath `
        -RegistryRestoreAction { param($record) $globalRetryAttempts.Add("registry") | Out-Null } `
        -ServiceRestoreAction { param($record) $globalRetryAttempts.Add("service") | Out-Null }
    Assert-Equal $globalRetryResult.Success $true "A mixed restore should resume after the failing action succeeds"
    Assert-Equal $globalRetryResult.RestoredCount 2 "The retry should restore the failed record and all older records"
    Assert-Equal (($globalRetryAttempts.ToArray()) -join ",") "service" "The retry must not replay newer restored records"
    $globalRetryAfter = Read-OptimizationChangeManifest -Path $globalFailurePath
    Assert-Equal (Get-RecordStatus $globalRetryAfter "ServiceChanges" "failure-service") "Restored" "The failed cross-collection record must be journaled on retry"
    Assert-Equal (Get-RecordStatus $globalRetryAfter "Operations" "failure-operation") "Restored" "Older cross-collection records must resume on retry"

    $inconsistentManifest = New-TestManifest -Operations @((New-TestRecord -Id "legacy-applied" -Sequence 1 -Status "Applied"))
    $inconsistentManifest.Status = "Restored"
    $inconsistentState = Get-OptimizationManifestRestoreState -Manifest $inconsistentManifest
    Assert-Equal $inconsistentState.State "Inconsistent" "A Restored session with outstanding records must be identified as inconsistent"
    Assert-Equal $inconsistentState.UnrestoredCount 1 "The inconsistent state must report its outstanding record count"
    $completeManifest = New-TestManifest -Operations @((New-TestRecord -Id "fully-restored" -Sequence 1 -Status "Restored"))
    $completeManifest.Status = "Restored"
    Assert-Equal (Get-OptimizationManifestRestoreState -Manifest $completeManifest).State "Restored" "A fully restored manifest must remain terminal"

    $wrapperPath = Join-Path $testRoot "wrapper-failures.json"
    $invalidRegistry = New-TestRecord -Id "registry-failure" -Sequence 1 -Kind "RegistryValue" -Target "invalid-registry" -Status "Applied" -Metadata ([PSCustomObject]@{
        Path = "HKCU:\Software\Win11OptimizerRestoreRegression"
        Name = "TestValue"
        OriginalType = "DWord"
        OriginalKeyExists = $false
    })
    $invalidService = New-TestRecord -Id "service-failure" -Sequence 2 -Kind "ServiceStartup" -Target "NotAWin11OptimizerService" -Status "Applied" -Metadata ([PSCustomObject]@{ OriginalState = "Stopped" })
    Write-TestManifest -Path $wrapperPath -Manifest (New-TestManifest -RegistryChanges @($invalidRegistry) -ServiceChanges @($invalidService))
    $registryFailure = Restore-RegistryChanges -ChangesJsonPath $wrapperPath
    $serviceFailure = Restore-ServiceChanges -ChangesJsonPath $wrapperPath
    Assert-Match ([string]$registryFailure.Errors[0]) "not allowlisted" "Registry restore must execute inside its module scope"
    Assert-Match ([string]$serviceFailure.Errors[0]) "not allowlisted" "Service restore must execute inside its module scope"
    $wrapperAfter = Read-OptimizationChangeManifest -Path $wrapperPath
    Assert-Equal (Get-RecordStatus $wrapperAfter "RegistryChanges" "registry-failure") "Applied" "A failed registry restore must remain retryable"
    Assert-Equal (Get-RecordStatus $wrapperAfter "ServiceChanges" "service-failure") "Applied" "A failed service restore must remain retryable"

    $operationWrapperPath = Join-Path $testRoot "operation-wrapper-failure.json"
    $unsupportedOperation = New-TestRecord -Id "operation-failure" -Sequence 1 -Kind "UnsupportedSyntheticOperation" -Target "synthetic" -Status "Applied"
    Write-TestManifest -Path $operationWrapperPath -Manifest (New-TestManifest -Operations @($unsupportedOperation))
    $operationFailure = Restore-OptimizationStateChanges -ChangesJsonPath $operationWrapperPath
    Assert-Equal $operationFailure.Success $false "An unsupported tracked operation must fail"
    Assert-Match ([string]$operationFailure.Errors[0]) "Unsupported tracked operation kind" "The operation wrapper must report unsupported operation kinds"
    $operationWrapperAfter = Read-OptimizationChangeManifest -Path $operationWrapperPath
    Assert-Equal (Get-RecordStatus $operationWrapperAfter "Operations" "operation-failure") "Applied" "A failed operation restore must remain retryable"

    $duplicatePath = Join-Path $testRoot "duplicate-ids.json"
    Write-TestManifest -Path $duplicatePath -Manifest (New-TestManifest -Operations @(
        (New-TestRecord -Id "duplicate" -Sequence 1 -Status "Applied"),
        (New-TestRecord -Id "duplicate" -Sequence 2 -Status "Applied")
    ))
    $duplicateAttempts = [System.Collections.ArrayList]::new()
    $duplicateAction = { param($record) $duplicateAttempts.Add([string]$record.Id) | Out-Null }.GetNewClosure()
    $duplicateError = ""
    try { $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $duplicatePath -Collection Operation -RestoreAction $duplicateAction } catch { $duplicateError = $_.Exception.Message }
    Assert-Match $duplicateError "duplicated" "Duplicate IDs must be rejected before restore starts"
    Assert-Equal $duplicateAttempts.Count 0 "Duplicate IDs must be rejected before any system action"

    $missingIdPath = Join-Path $testRoot "missing-id.json"
    $missingIdRecord = New-TestRecord -Id "placeholder" -Sequence 1 -Status "Applied"
    $missingIdRecord.Id = " "
    Write-TestManifest -Path $missingIdPath -Manifest (New-TestManifest -Operations @($missingIdRecord))
    $missingIdAttempts = [System.Collections.ArrayList]::new()
    $missingIdAction = { param($record) $missingIdAttempts.Add([string]$record.Target) | Out-Null }.GetNewClosure()
    $missingIdError = ""
    try { $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $missingIdPath -Collection Operation -RestoreAction $missingIdAction } catch { $missingIdError = $_.Exception.Message }
    Assert-Match $missingIdError "no ID" "Missing IDs must be rejected before restore starts"
    Assert-Equal $missingIdAttempts.Count 0 "Missing IDs must be rejected before any system action"

    $unsupportedStatusPath = Join-Path $testRoot "unsupported-status.json"
    $unsupportedStatusRecord = New-TestRecord -Id "unsupported-status" -Sequence 1 -Status "Unexpected"
    Write-TestManifest -Path $unsupportedStatusPath -Manifest (New-TestManifest -Operations @($unsupportedStatusRecord))
    $unsupportedStatusAttempts = [System.Collections.ArrayList]::new()
    $unsupportedStatusAction = { param($record) $unsupportedStatusAttempts.Add([string]$record.Id) | Out-Null }.GetNewClosure()
    $unsupportedStatusError = ""
    try { $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $unsupportedStatusPath -Collection Operation -RestoreAction $unsupportedStatusAction } catch { $unsupportedStatusError = $_.Exception.Message }
    Assert-Match $unsupportedStatusError "unsupported status" "Unsupported statuses must be rejected before restore starts"
    Assert-Equal $unsupportedStatusAttempts.Count 0 "Unsupported statuses must be rejected before any system action"

    $globalDuplicateIdPath = Join-Path $testRoot "global-duplicate-id.json"
    Write-TestManifest -Path $globalDuplicateIdPath -Manifest (New-TestManifest `
        -RegistryChanges @((New-TestRecord -Id "cross-duplicate" -Sequence 1 -Kind "RegistryValue" -Status "Applied")) `
        -ServiceChanges @((New-TestRecord -Id "cross-duplicate" -Sequence 2 -Kind "ServiceStartup" -Status "Applied")))
    $globalValidationAttempts = [System.Collections.ArrayList]::new()
    $globalDuplicateIdError = ""
    try {
        $null = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalDuplicateIdPath `
            -RegistryRestoreAction { param($record) $globalValidationAttempts.Add("registry") | Out-Null } `
            -ServiceRestoreAction { param($record) $globalValidationAttempts.Add("service") | Out-Null }
    } catch { $globalDuplicateIdError = $_.Exception.Message }
    Assert-Match $globalDuplicateIdError "duplicated" "Duplicate IDs across collections must be rejected before restore starts"
    Assert-Equal $globalValidationAttempts.Count 0 "Duplicate cross-collection IDs must be rejected before any action"

    $globalDuplicateSequencePath = Join-Path $testRoot "global-duplicate-sequence.json"
    Write-TestManifest -Path $globalDuplicateSequencePath -Manifest (New-TestManifest `
        -RegistryChanges @((New-TestRecord -Id "sequence-registry" -Sequence 1 -Kind "RegistryValue" -Status "Applied")) `
        -ServiceChanges @((New-TestRecord -Id "sequence-service" -Sequence 1 -Kind "ServiceStartup" -Status "Applied")))
    $globalDuplicateSequenceError = ""
    try {
        $null = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalDuplicateSequencePath `
            -RegistryRestoreAction { param($record) $globalValidationAttempts.Add("registry") | Out-Null } `
            -ServiceRestoreAction { param($record) $globalValidationAttempts.Add("service") | Out-Null }
    } catch { $globalDuplicateSequenceError = $_.Exception.Message }
    Assert-Match $globalDuplicateSequenceError "sequence 1 is duplicated" "Duplicate sequences across collections must be rejected before restore starts"
    Assert-Equal $globalValidationAttempts.Count 0 "Duplicate cross-collection sequences must be rejected before any action"

    $globalInvalidRecordPath = Join-Path $testRoot "global-invalid-record.json"
    $invalidGlobalRecord = New-TestRecord -Id "invalid-global" -Sequence 1 -Kind "ServiceStartup" -Status "Unexpected"
    Write-TestManifest -Path $globalInvalidRecordPath -Manifest (New-TestManifest -ServiceChanges @($invalidGlobalRecord))
    $globalInvalidRecordError = ""
    try {
        $null = Invoke-OptimizationManifestRestore -ChangesJsonPath $globalInvalidRecordPath `
            -RegistryRestoreAction { param($record) $globalValidationAttempts.Add("registry") | Out-Null } `
            -ServiceRestoreAction { param($record) $globalValidationAttempts.Add("service") | Out-Null }
    } catch { $globalInvalidRecordError = $_.Exception.Message }
    Assert-Match $globalInvalidRecordError "unsupported status" "Invalid global record statuses must be rejected before restore starts"
    Assert-Equal $globalValidationAttempts.Count 0 "Invalid global records must be rejected before any action"

    $journalFailurePath = Join-Path $testRoot "journal-failure.json"
    Write-TestManifest -Path $journalFailurePath -Manifest (New-TestManifest -Operations @(
        (New-TestRecord -Id "journal-second" -Sequence 1 -Status "Applied"),
        (New-TestRecord -Id "journal-first" -Sequence 2 -Status "Applied")
    ))
    $journalAttempts = [System.Collections.ArrayList]::new()
    $journalLockState = [PSCustomObject]@{ Handle = $null }
    $journalFailureAction = {
        param($record)
        $journalAttempts.Add([string]$record.Id) | Out-Null
        $journalLockState.Handle = [IO.File]::Open(
            $journalFailurePath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite
        )
    }.GetNewClosure()
    $journalFailureError = ""
    try {
        $null = Invoke-TrackedRestoreRecords -ChangesJsonPath $journalFailurePath -Collection Operation -RestoreAction $journalFailureAction
    } catch {
        $journalFailureError = $_.Exception.Message
    } finally {
        if ($null -ne $journalLockState.Handle) {
            $journalLockState.Handle.Dispose()
            $journalLockState.Handle = $null
        }
    }
    Assert-Match $journalFailureError "journal update failed" "A journal persistence failure must be reported"
    Assert-Equal (($journalAttempts.ToArray()) -join ",") "journal-first" "A journal persistence failure must stop remaining restore actions"
    $afterJournalFailure = Read-OptimizationChangeManifest -Path $journalFailurePath
    Assert-Equal (Get-RecordStatus $afterJournalFailure "Operations" "journal-first") "Applied" "A restored action must remain retryable when its journal update fails"
    Assert-Equal (Get-RecordStatus $afterJournalFailure "Operations" "journal-second") "Applied" "Remaining actions must stay retryable after a journal update fails"

    $journalRetryAttempts = [System.Collections.ArrayList]::new()
    $journalRetryAction = { param($record) $journalRetryAttempts.Add([string]$record.Id) | Out-Null }.GetNewClosure()
    $journalRetryResult = Invoke-TrackedRestoreRecords -ChangesJsonPath $journalFailurePath -Collection Operation -RestoreAction $journalRetryAction
    Assert-Equal $journalRetryResult.Success $true "A restore must be retryable after the journal lock is released"
    Assert-Equal $journalRetryResult.RestoredCount 2 "The retry must journal both outstanding actions"
    Assert-Equal (($journalRetryAttempts.ToArray()) -join ",") "journal-first,journal-second" "A journal failure retry must repeat the unjournaled action before older actions"
    $afterJournalRetry = Read-OptimizationChangeManifest -Path $journalFailurePath
    Assert-Equal (Get-RecordStatus $afterJournalRetry "Operations" "journal-first") "Restored" "The repeated action must be journaled after retry"
    Assert-Equal (Get-RecordStatus $afterJournalRetry "Operations" "journal-second") "Restored" "Older actions must resume after the repeated action is journaled"

    $pendingJournalPath = Join-Path $testRoot "pending-after-journal-failure.json"
    Initialize-OptimizationChangeTracker -JournalPath $pendingJournalPath | Out-Null
    $pendingChangeId = Register-OptimizationChange -Kind "PowerSchemeCreated" -Target "synthetic" -OriginalValue $null -NewValue $null -OriginalExists $true
    $pendingJournalHandle = [IO.File]::Open($pendingJournalPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $pendingJournalError = ""
    try {
        Set-OptimizationChangeResult -Id $pendingChangeId -Status Applied
    } catch {
        $pendingJournalError = $_.Exception.Message
    } finally {
        $pendingJournalHandle.Dispose()
    }
    Assert-Match $pendingJournalError ".+" "An Applied journal write failure must be surfaced"
    $pendingAfterFailure = Read-OptimizationChangeManifest -Path $pendingJournalPath
    Assert-Equal (Get-RecordStatus $pendingAfterFailure "Operations" $pendingChangeId) "Pending" "The durable record must remain Pending when Applied cannot be persisted"
    $pendingRecoveryAttempts = [System.Collections.ArrayList]::new()
    $pendingRecovery = Invoke-TrackedRestoreRecords -ChangesJsonPath $pendingJournalPath -Collection Operation -RestoreAction {
        param($record)
        $pendingRecoveryAttempts.Add([string]$record.Id) | Out-Null
    }
    Assert-Equal $pendingRecovery.Success $true "A Pending record must remain recoverable after an Applied journal failure"
    Assert-Equal (($pendingRecoveryAttempts.ToArray()) -join ",") $pendingChangeId "Recovery must replay the unjournaled successful action"
    $pendingAfterRecovery = Read-OptimizationChangeManifest -Path $pendingJournalPath
    Assert-Equal ([string](Get-RecordProperty $pendingAfterRecovery "Operations" $pendingChangeId "RestoredFromStatus")) "Pending" "Pending recovery provenance must be persisted"

    $restorePointModule = Get-Module RestorePoint
    $limitedRestorePoint = & $restorePointModule {
        function Enable-ComputerRestore { [CmdletBinding()] param([string]$Drive) }
        function Get-ComputerRestorePoint { [CmdletBinding()] param() return @() }
        function Start-Sleep { [CmdletBinding()] param([int]$Milliseconds) }
        function Checkpoint-Computer {
            [CmdletBinding()]
            param([string]$Description, [string]$RestorePointType)
            Write-Warning "A new system restore point cannot be created because one was created within the past 1440 minutes."
        }
        New-OptimizationRestorePoint -Description "Win11Opt-RestorePointLimitTest"
    }
    Assert-Equal $limitedRestorePoint.Success $false "The Windows restore-point frequency limit must remain a warning result"
    Assert-Match $limitedRestorePoint.Message "last 24 hours" "The restore-point frequency warning must explain the 24-hour limit"

    $changeTrackingModule = Get-Module ChangeTracking
    $originalPowerGuid = "381b4222-f694-41f0-9685-ff5bb260df2e"
    $createdPowerGuid = "11111111-2222-3333-4444-555555555555"

    $activeSchemeCalls = [System.Collections.ArrayList]::new()
    $activeSchemeOperation = New-TestRecord -Id "power-active" -Sequence 1 -Kind "PowerActiveScheme" -Status "Applied" -Target $createdPowerGuid -OriginalValue $originalPowerGuid
    & $changeTrackingModule {
        param($Operation, $Calls)
        function Invoke-CheckedNativeCommand {
            param([string]$FilePath, [string[]]$ArgumentList)
            $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
            $output = if ($ArgumentList[0] -eq "/getactivescheme") { @("Power Scheme GUID: $($Operation.OriginalValue)") } else { @() }
            return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = $output; Command = $FilePath }
        }
        Invoke-OperationRestore -Operation $Operation
    } $activeSchemeOperation $activeSchemeCalls
    Assert-Equal (($activeSchemeCalls.ToArray()) -join ",") "powercfg.exe /setactive $originalPowerGuid,powercfg.exe /getactivescheme" "Active power scheme restore must set and verify the saved scheme"

    $deleteSchemeCalls = [System.Collections.ArrayList]::new()
    $deleteSchemeState = @{ ListCount = 0 }
    $deleteSchemeOperation = New-TestRecord -Id "power-created" -Sequence 2 -Kind "PowerSchemeCreated" -Status "Applied" -Target $createdPowerGuid -OriginalExists $false -OriginalValue $null
    & $changeTrackingModule {
        param($Operation, $Calls, $State, $FallbackGuid)
        function Invoke-CheckedNativeCommand {
            param([string]$FilePath, [string[]]$ArgumentList)
            $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
            $output = switch ($ArgumentList[0]) {
                "/list" {
                    $State.ListCount++
                    if ($State.ListCount -eq 1) { @("Power Scheme GUID: $($Operation.Target)") } else { @("Power Scheme GUID: $FallbackGuid") }
                }
                "/getactivescheme" { @("Power Scheme GUID: $FallbackGuid") }
                default { @() }
            }
            return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = $output; Command = $FilePath }
        }
        Invoke-OperationRestore -Operation $Operation
    } $deleteSchemeOperation $deleteSchemeCalls $deleteSchemeState $originalPowerGuid
    Assert-Equal (($deleteSchemeCalls.ToArray()) -join ",") "powercfg.exe /list,powercfg.exe /getactivescheme,powercfg.exe /delete $createdPowerGuid,powercfg.exe /list" "Created power scheme restore must verify, delete, and verify again"

    $activeCreatedCalls = [System.Collections.ArrayList]::new()
    $activeCreatedOperation = New-TestRecord -Id "power-created-active" -Sequence 3 -Kind "PowerSchemeCreated" -Status "Applied" -Target $createdPowerGuid -OriginalExists $false -OriginalValue $null
    $activeCreatedError = ""
    try {
        & $changeTrackingModule {
            param($Operation, $Calls)
            function Invoke-CheckedNativeCommand {
                param([string]$FilePath, [string[]]$ArgumentList)
                $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
                return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = @("Power Scheme GUID: $($Operation.Target)"); Command = $FilePath }
            }
            Invoke-OperationRestore -Operation $Operation
        } $activeCreatedOperation $activeCreatedCalls
    } catch {
        $activeCreatedError = $_.Exception.Message
    }
    Assert-Match $activeCreatedError "Cannot delete the optimizer power scheme while it is active" "An active optimizer power scheme must not be deleted"
    Assert-Equal (($activeCreatedCalls.ToArray()) -join ",") "powercfg.exe /list,powercfg.exe /getactivescheme" "Active created scheme refusal must stop before delete"
    Assert-Equal $activeCreatedOperation.Status "Applied" "A refused power scheme deletion must remain retryable"

    $serviceModule = Get-Module Service
    $automaticWithoutDelay = & $serviceModule {
        function Get-ItemProperty {
            [CmdletBinding()]
            param([string]$Path, [string]$Name)
            return $null
        }
        try {
            Get-ServiceStartupMode -Service ([PSCustomObject]@{ Name = "SysMain"; StartType = "Automatic" })
        } finally {
            Remove-Item Function:\Get-ItemProperty -Force -ErrorAction SilentlyContinue
        }
    }
    Assert-Equal $automaticWithoutDelay "Automatic" "A missing DelayedAutoStart value must mean ordinary automatic startup"

    $serviceStartupCalls = [System.Collections.ArrayList]::new()
    $serviceStartupCases = [ordered]@{
        AutomaticDelayedStart = "delayed-auto"
        Automatic = "auto"
        Manual = "demand"
        Disabled = "disabled"
    }
    & $serviceModule {
        param($Cases, $Calls)
        function Invoke-CheckedNativeCommand {
            param([string]$FilePath, [string[]]$ArgumentList)
            $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
            return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = @(); Command = $FilePath }
        }
        function Get-ItemProperty { return [PSCustomObject]@{ Group = "" } }
        function Set-Service { throw "Set-Service must not apply service startup modes" }
        function New-ItemProperty { throw "Registry writes must not apply delayed service startup" }
        try {
            foreach ($case in $Cases.GetEnumerator()) {
                Set-ServiceStartupMode -ServiceName "SysMain" -StartupType $case.Key
            }
        } finally {
            Remove-Item Function:\Invoke-CheckedNativeCommand -Force -ErrorAction SilentlyContinue
            Remove-Item Function:\Get-ItemProperty -Force -ErrorAction SilentlyContinue
            Remove-Item Function:\Set-Service -Force -ErrorAction SilentlyContinue
            Remove-Item Function:\New-ItemProperty -Force -ErrorAction SilentlyContinue
        }
    } $serviceStartupCases $serviceStartupCalls
    Assert-Equal (($serviceStartupCalls.ToArray()) -join ",") "sc.exe config SysMain start= delayed-auto,sc.exe config SysMain start= auto,sc.exe config SysMain start= demand,sc.exe config SysMain start= disabled" "Every service startup mode must use the corresponding SCM configuration value"

    $groupedServiceCalls = [System.Collections.ArrayList]::new()
    $groupedServiceError = & $serviceModule {
        param($Calls)
        function Get-ItemProperty { return [PSCustomObject]@{ Group = "profsvc_group" } }
        function Invoke-CheckedNativeCommand {
            param([string]$FilePath, [string[]]$ArgumentList)
            $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
        }
        try {
            Set-ServiceStartupMode -ServiceName "SysMain" -StartupType "AutomaticDelayedStart"
            return ""
        } catch {
            return $_.Exception.Message
        } finally {
            Remove-Item Function:\Get-ItemProperty -Force -ErrorAction SilentlyContinue
            Remove-Item Function:\Invoke-CheckedNativeCommand -Force -ErrorAction SilentlyContinue
        }
    } $groupedServiceCalls
    Assert-Match $groupedServiceError "profsvc_group" "A service in a load-order group must reject delayed automatic startup with the group name"
    Assert-Equal $groupedServiceCalls.Count 0 "A blocked delayed startup target must not invoke sc.exe"

    $emptyRegistryFile = Join-Path $testRoot "empty.reg"
    [IO.File]::WriteAllText($emptyRegistryFile, "Windows Registry Editor Version 5.00`r`n`r`n", (New-Object Text.UnicodeEncoding($false, $true)))
    $nativeResult = Invoke-CheckedNativeCommand -FilePath "reg.exe" -ArgumentList @("import", $emptyRegistryFile)
    Assert-Equal $nativeResult.Success $true "Successful native commands that write to stderr must not become terminating PowerShell errors"
    Assert-Equal $nativeResult.ExitCode 0 "The native command exit code must remain authoritative"

    $backupDirectory = Join-Path $testRoot "backup_service_array"
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
    $backupManifest = [PSCustomObject][ordered]@{
        SchemaVersion = 2
        Tool = "Win11Optimizer"
        Kind = "PreApplyBackup"
        BackupId = "backup_service_array"
        ServicesSnapshot = "services_snapshot.json"
        RegistryExports = @()
        PowerScheme = $null
    }
    Write-TestManifest -Path (Join-Path $backupDirectory "backup_manifest.json") -Manifest $backupManifest
    $serviceSnapshot = @(
        [PSCustomObject]@{ Name = "TestAutomatic"; StartMode = "Auto" },
        [PSCustomObject]@{ Name = "TestManual"; StartMode = "Manual" }
    )
    [IO.File]::WriteAllText(
        (Join-Path $backupDirectory "services_snapshot.json"),
        (ConvertTo-Json -InputObject $serviceSnapshot -Depth 4),
        (New-Object Text.UTF8Encoding($false))
    )
    $serviceCalls = [System.Collections.ArrayList]::new()
    $backupModule = Get-Module Backup
    $backupResult = & $backupModule {
        param($BackupPath, $Calls)
        function Set-Service {
            [CmdletBinding()]
            param([string]$Name, [string]$StartupType)
            $Calls.Add("$Name`:$StartupType") | Out-Null
        }
        try {
            Restore-OptimizationBackup -BackupPath $BackupPath -SkipRegistry -SkipPower
        } finally {
            Remove-Item Function:\Set-Service -Force -ErrorAction SilentlyContinue
        }
    } $backupDirectory $serviceCalls
    Assert-Equal $backupResult.Success $true "A JSON service array must restore as individual service records"
    Assert-Equal $backupResult.RestoredCount 2 "Every service record in the snapshot must be restored"
    Assert-Equal (($serviceCalls.ToArray()) -join ",") "TestAutomatic:Automatic,TestManual:Manual" "Service names and startup modes must not be collapsed into arrays"

    $savedPowerGuid = "457ef5b1-1387-4af3-aa84-d828d1e596f3"
    $powerFile = Join-Path $backupDirectory "active_power_scheme.pow"
    [IO.File]::WriteAllBytes($powerFile, [byte[]]@(0))
    $backupManifest.ServicesSnapshot = $null
    $backupManifest.PowerScheme = [PSCustomObject]@{ ActiveGuid = $savedPowerGuid; File = "active_power_scheme.pow" }
    Write-TestManifest -Path (Join-Path $backupDirectory "backup_manifest.json") -Manifest $backupManifest
    $powerCalls = [System.Collections.ArrayList]::new()
    $powerResult = & $backupModule {
        param($BackupPath, $Calls, $SavedGuid)
        function Invoke-CheckedNativeCommand {
            [CmdletBinding()]
            param([string]$FilePath, [string[]]$ArgumentList)
            $Calls.Add("$FilePath $($ArgumentList -join ' ')") | Out-Null
            $output = switch ($ArgumentList[0]) {
                "/list" { @("Power Scheme GUID: $SavedGuid") }
                "/getactivescheme" { @("Power Scheme GUID: $SavedGuid") }
                default { @() }
            }
            return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = $output; Command = $FilePath }
        }
        try {
            Restore-OptimizationBackup -BackupPath $BackupPath -SkipRegistry -SkipServices
        } finally {
            Remove-Item Function:\Invoke-CheckedNativeCommand -Force -ErrorAction SilentlyContinue
        }
    } $backupDirectory $powerCalls $savedPowerGuid
    Assert-Equal $powerResult.Success $true "An existing saved power scheme must be reactivated"
    Assert-Equal $powerResult.RestoredCount 1 "The saved power scheme must count as one restored item"
    Assert-Equal (($powerCalls.ToArray()) -join ",") "powercfg.exe /list,powercfg.exe /setactive $savedPowerGuid,powercfg.exe /getactivescheme" "An existing saved power scheme must not be imported as a duplicate"

    Write-Output "Restore retry regression tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
        if (-not $resolvedTestRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a test directory outside the system temporary directory"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
