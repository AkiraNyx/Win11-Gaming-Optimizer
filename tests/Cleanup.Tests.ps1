#Requires -Version 5.1
<#
Regression tests for the cleanup engine, covering the four failure modes raised in
review: junction escape, per-file retention, preview scope drift, and partial
failure reporting.

Run:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Cleanup.Tests.ps1
#>

$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "..\scripts\cleanup\CleanupEngine.psm1") -Force
# The engine consumes this internally; the tests read identities directly to
# build records for the scope-refusal case.
Import-Module (Join-Path $PSScriptRoot "..\scripts\cleanup\CleanupNative.psm1") -Force

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Assertion failed: $Message" }
    Write-Host "  ok   $Message"
}

function New-TestRoot {
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("cleanup-test-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function New-TestTarget {
    param([string]$Root, [string]$Kind = "contents")
    [pscustomobject]@{
        Id             = "test-target"
        Group          = "test"
        Label          = "test"
        Description    = ""
        Risk           = "safe"
        Kind           = $Kind
        Paths          = @($Root)
        Pattern        = "*"
        OlderThanDays  = -1
        RequiresAdmin  = $false
        Note           = ""
        DefaultSelected = $false
    }
}

# Remove a test tree without following junctions: Remove-Item -Recurse would delete
# the *target* of a junction on Windows PowerShell 5.1.
function Remove-TestTree {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($entry in @([System.IO.Directory]::EnumerateFileSystemEntries($Path))) {
        $attributes = [System.IO.File]::GetAttributes($entry)
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            [System.IO.Directory]::Delete($entry)
        } elseif (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
            Remove-TestTree -Path $entry
        } else {
            [System.IO.File]::Delete($entry)
        }
    }
    [System.IO.Directory]::Delete($Path)
}

function Write-AgedFile {
    param([string]$Path, [int]$AgeDays, [string]$Content = "x")
    $parent = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content)
    [System.IO.File]::SetLastWriteTime($Path, (Get-Date).AddDays(-$AgeDays))
}

# ---------------------------------------------------------------------------
Write-Host "`n[1] junction inside a cleanup root must not be traversed" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $outside = Join-Path $base "outside"
    New-Item -ItemType Directory -Path $root, $outside -Force | Out-Null
    Write-AgedFile -Path (Join-Path $outside "secret.txt") -AgeDays 30 -Content "keep me"
    Write-AgedFile -Path (Join-Path $root "stale.log") -AgeDays 30

    $link = Join-Path $root "link"
    New-Item -ItemType Junction -Path $link -Target $outside | Out-Null

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true

    $joined = @($inventory.Files | Where-Object { $_ -like "*secret.txt" })
    Assert-True ($joined.Count -eq 0) "scan does not list files behind a junction"
    Assert-True ($inventory.ReparseSkipped -ge 1) "scan counts the junction as skipped"

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records
    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (Test-Path -LiteralPath (Join-Path $outside "secret.txt")) "file outside the root survives"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root "stale.log"))) "in-scope stale file is removed"
    Assert-True (Test-Path -LiteralPath $link) "the junction itself is left in place"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[2] a cleanup root that is itself a junction is refused" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $real = Join-Path $base "real"
    New-Item -ItemType Directory -Path $real -Force | Out-Null
    Write-AgedFile -Path (Join-Path $real "old.log") -AgeDays 30

    $alias = Join-Path $base "alias"
    New-Item -ItemType Junction -Path $alias -Target $real | Out-Null

    $target = New-TestTarget -Root $alias
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true

    Assert-True (-not $inventory.Available) "root reached through a junction is not available"
    Assert-True ($inventory.Files.Count -eq 0) "no files are collected for a junction root"
    Assert-True (-not (Test-CleanupPathContained -Path (Join-Path $alias "old.log") -Root $real)) "path resolved through a junction alias is refused"
    Assert-True (Test-CleanupPathContained -Path (Join-Path $real "old.log") -Root $real) "the real path is accepted"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[3] retention is decided per file, not per directory" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $oldDir = Join-Path $root "old"
    Write-AgedFile -Path (Join-Path $oldDir "old.log") -AgeDays 10 -Content "old"
    Write-AgedFile -Path (Join-Path $oldDir "fresh.log") -AgeDays 0 -Content "fresh"

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true

    $names = @($inventory.Files | ForEach-Object { Split-Path $_ -Leaf })
    Assert-True ($names -contains "old.log") "old file inside an old directory is listed"
    Assert-True (-not ($names -contains "fresh.log")) "fresh file inside the same old directory is not listed"

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records
    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $null = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (-not (Test-Path -LiteralPath (Join-Path $oldDir "old.log"))) "old file is removed"
    Assert-True (Test-Path -LiteralPath (Join-Path $oldDir "fresh.log")) "fresh file survives"
    Assert-True (Test-Path -LiteralPath $oldDir) "directory containing a fresh file is not pruned"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[4] apply deletes only what the preview listed" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    Write-AgedFile -Path (Join-Path $root "previewed.log") -AgeDays 10
    Write-AgedFile -Path (Join-Path $root "kept-new.log") -AgeDays 0

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records

    # A file that appears after the user confirmed the preview.
    Write-AgedFile -Path (Join-Path $root "appeared-later.log") -AgeDays 10

    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $null = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root "previewed.log"))) "previewed file is removed"
    Assert-True (Test-Path -LiteralPath (Join-Path $root "appeared-later.log")) "file created after the preview survives"
    Assert-True (Test-Path -LiteralPath (Join-Path $root "kept-new.log")) "file newer than the cutoff survives"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[5] a stale or missing plan is rejected instead of re-scanned" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    Write-AgedFile -Path (Join-Path $root "old.log") -AgeDays 10
    $target = New-TestTarget -Root $root
    $planDir = Join-Path $base "plans"

    $missing = Read-CleanupPlan -Directory $planDir -PlanId ([guid]::NewGuid().ToString("N")) -TargetId $target.Id
    Assert-True ($null -eq $missing) "missing plan returns null"

    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records @()
    $otherTarget = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId "different-target"
    Assert-True ($null -eq $otherTarget) "plan does not load for a different target"

    $planMeta = Join-Path (Join-Path $planDir $planId) "$($target.Id).meta.json"
    $meta = Get-Content -LiteralPath $planMeta -Raw | ConvertFrom-Json
    $meta.createdAt = (Get-Date).AddHours(-2).ToString("o")
    $meta | ConvertTo-Json -Compress | Set-Content -LiteralPath $planMeta -Encoding UTF8
    $expired = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -MaxAgeMinutes 30
    Assert-True ($null -eq $expired) "expired plan is rejected"
    Assert-True (Test-Path -LiteralPath (Join-Path $root "old.log")) "nothing is deleted without a valid plan"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[6] a locked file produces a partial result, not a silent success" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $locked = Join-Path $root "locked.log"
    Write-AgedFile -Path $locked -AgeDays 10
    Write-AgedFile -Path (Join-Path $root "free.log") -AgeDays 10

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records
    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id

    $handle = [System.IO.File]::Open($locked, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    try {
        $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)
    } finally {
        $handle.Dispose()
    }

    Assert-True ($removal.Status -eq "partial") "locked file yields status=partial (got $($removal.Status))"
    Assert-True ($removal.FailureCount -ge 1) "failure count includes the locked file"
    Assert-True ($removal.RemovedFiles -ge 1) "files that could be deleted are still removed"
    Assert-True (Test-Path -LiteralPath $locked) "locked file still exists"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[7] a plan entry outside the allowed roots is refused" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $outside = Join-Path $base "outside"
    New-Item -ItemType Directory -Path $root, $outside -Force | Out-Null
    Write-AgedFile -Path (Join-Path $outside "secret.txt") -AgeDays 10
    Write-AgedFile -Path (Join-Path $root "old.log") -AgeDays 10

    $target = New-TestTarget -Root $root
    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    # A tampered plan that tries to reach outside the declared root.
    $insidePath = Join-Path $root "old.log"
    $outsidePath = Join-Path $outside "secret.txt"
    $insideId = Get-CleanupFileIdentity -Path $insidePath
    $outsideId = Get-CleanupFileIdentity -Path $outsidePath
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records @(
        [pscustomobject]@{ Path = $insidePath; Size = $insideId.Size; WriteTicks = $insideId.WriteTicks; FileId = $insideId.FileId; VolumeSerial = $insideId.VolumeSerial },
        [pscustomobject]@{ Path = $outsidePath; Size = $outsideId.Size; WriteTicks = $outsideId.WriteTicks; FileId = $outsideId.FileId; VolumeSerial = $outsideId.VolumeSerial }
    )
    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (Test-Path -LiteralPath (Join-Path $outside "secret.txt")) "path outside allowed roots is never deleted"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root "old.log"))) "in-scope entry is still deleted"
    Assert-True ($removal.FailureCount -ge 1) "out-of-scope entry is reported as a failure"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[8] a file regenerated after the preview is skipped" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $file = Join-Path $root "cache.bin"
    Write-AgedFile -Path $file -AgeDays 10 -Content "original"

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true
    Assert-True ($inventory.Records.Count -eq 1) "the preview records exactly one file"

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records

    # The owning application rewrites the same path after the preview.
    [System.IO.File]::WriteAllText($file, "regenerated content")
    [System.IO.File]::SetLastWriteTime($file, (Get-Date))

    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (Test-Path -LiteralPath $file) "regenerated file survives"
    Assert-True ($removal.RemovedFiles -eq 0) "nothing is deleted for a replaced file"
    Assert-True ($removal.FailureCount -ge 1) "the replacement is reported, not silently skipped"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Host "`n[9] a parent swapped for a junction after the preview cannot redirect the delete" -ForegroundColor Cyan
# ---------------------------------------------------------------------------
$base = New-TestRoot
try {
    $root = Join-Path $base "root"
    $sub = Join-Path $root "sub"
    Write-AgedFile -Path (Join-Path $sub "old.log") -AgeDays 10

    $target = New-TestTarget -Root $root
    $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays 1 -IsAdmin $true
    Assert-True ($inventory.Records.Count -eq 1) "the preview records the file under root\sub"

    $planDir = Join-Path $base "plans"
    $planId = [guid]::NewGuid().ToString("N")
    $null = Save-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id -Roots @($root) -Records $inventory.Records

    # Replace the previewed directory with a junction that points outside the root.
    $outside = Join-Path $base "outside"
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    Write-AgedFile -Path (Join-Path $outside "old.log") -AgeDays 10 -Content "valuable"
    Remove-TestTree -Path $sub
    New-Item -ItemType Junction -Path $sub -Target $outside | Out-Null

    $plan = Read-CleanupPlan -Directory $planDir -PlanId $planId -TargetId $target.Id
    $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($root)

    Assert-True (Test-Path -LiteralPath (Join-Path $outside "old.log")) "file behind the substituted junction survives"
    Assert-True ($removal.RemovedFiles -eq 0) "nothing outside the root is deleted"
    Assert-True ($removal.FailureCount -ge 1) "the substitution is reported as a failure"
} finally {
    Remove-TestTree -Path $base
}

# ---------------------------------------------------------------------------
Write-Output "Cleanup regression tests passed"
