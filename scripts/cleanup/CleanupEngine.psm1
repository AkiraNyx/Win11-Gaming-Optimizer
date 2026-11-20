#Requires -Version 5.1

<#
Cleanup engine.

Design contract (see the review on the cleanup pull request):

1. Containment. A cleanup root is only usable when the whole path from the volume
   root down to the root is free of reparse points, and every candidate is proven
   to live below that root. Traversal never follows a reparse point, so a junction
   inside a cleaned directory cannot pull files in from elsewhere.

2. Age is decided per file, never per directory. A stale directory that still
   receives writes keeps its fresh files; only files older than the cutoff are
   removed, and a directory is pruned only once it is empty.

3. Preview equals execution. Scan writes the exact file list to a plan file and
   apply deletes that list. Anything created after the preview is not deleted;
   a missing or expired plan is reported as stale instead of being re-scanned.

4. Failures are counted per target, and a target that throws is "failed", not
   silently "ok".
#>

$script:ReparseFlag = [System.IO.FileAttributes]::ReparsePoint
$script:DirectoryFlag = [System.IO.FileAttributes]::Directory

function Get-NormalizedCleanupPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try { return [System.IO.Path]::GetFullPath($Path) } catch { return $null }
}

function Test-ReparseItem {
    param([System.IO.FileSystemInfo]$Item)
    if ($null -eq $Item) { return $false }
    return (($Item.Attributes -band $script:ReparseFlag) -ne 0)
}

<#
Verifies that $Path is the same as, or below, $Root, and that no component of
the path (up to the volume root) is a reparse point. A junction anywhere in the
chain means the real target is unknown, so the path is refused.
#>
function Test-CleanupPathContained {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $full = Get-NormalizedCleanupPath $Path
    $rootFull = Get-NormalizedCleanupPath $Root
    if (-not $full -or -not $rootFull) { return $false }
    $rootFull = $rootFull.TrimEnd('\')

    $contained = ($full -eq $rootFull) -or $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $contained) { return $false }

    $current = $full
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -eq $item) { return $false }
        if (Test-ReparseItem $item) { return $false }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    return $true
}

<#
Walks $Root without following reparse points. Returns file paths only; directory
entries are used for traversal and are not reported.
#>
function Get-CleanupTreeFiles {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Filter = ""
    )

    $files = [System.Collections.Generic.List[string]]::new()
    $reparseSkipped = 0
    $unreadable = 0
    $stack = [System.Collections.Generic.Stack[string]]::new()
    $stack.Push($Root)

    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        $entries = $null
        try { $entries = [System.IO.Directory]::EnumerateFileSystemEntries($dir) } catch { $unreadable++; continue }
        foreach ($entry in $entries) {
            $attributes = $null
            try { $attributes = [System.IO.File]::GetAttributes($entry) } catch { $unreadable++; continue }
            if (($attributes -band $script:ReparseFlag) -ne 0) { $reparseSkipped++; continue }
            if (($attributes -band $script:DirectoryFlag) -ne 0) { $stack.Push($entry); continue }
            if ($Filter -and -not ($entry -like $Filter)) { continue }
            $files.Add($entry)
        }
    }

    [pscustomobject]@{
        Files          = @($files.ToArray())
        ReparseSkipped = $reparseSkipped
        Unreadable     = $unreadable
    }
}

<#
Expands a declared root that may contain wildcards. Each expanded directory is
validated against itself (whole-chain containment) before use.
#>
function Resolve-CleanupRoots {
    param([string]$Pattern)

    $expanded = @()
    if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($Pattern)) {
        $expanded = @(Get-Item -Path $Pattern -ErrorAction SilentlyContinue |
                      Where-Object { $_.PSIsContainer } |
                      ForEach-Object { $_.FullName })
    } elseif (Test-Path -LiteralPath $Pattern -PathType Container) {
        $expanded = @((Get-Item -LiteralPath $Pattern).FullName)
    }

    $accepted = [System.Collections.Generic.List[string]]::new()
    $rejected = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in $expanded) {
        if (-not $seen.Add($dir)) { continue }
        if (Test-CleanupPathContained -Path $dir -Root $dir) { $accepted.Add($dir) }
        else { $rejected.Add($dir) }
    }

    [pscustomobject]@{
        Roots    = @($accepted.ToArray())
        Rejected = @($rejected.ToArray())
    }
}

<#
Inventory for one target.

Returns the exact file list that a subsequent apply may delete, together with
the byte total for that list. Nothing else is counted: the preview number and
the delete set must be the same thing.
#>
function Get-CleanupTargetInventory {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [int]$OlderThanDays = 1,
        [bool]$IsAdmin = $false
    )

    $inventory = [pscustomobject]@{
        Available          = $true
        SkippedReason      = ""
        Roots              = @()
        Files              = @()
        Bytes              = [int64]0
        ReparseSkipped     = 0
        ContainmentDenied  = @()
        Warnings           = @()
    }

    if ($Target.RequiresAdmin -and -not $IsAdmin) {
        $inventory.Available = $false
        $inventory.SkippedReason = "需要管理员权限才能读取"
        return $inventory
    }

    $cutoff = if ($OlderThanDays -ge 0) { (Get-Date).AddDays(-$OlderThanDays) } else { $null }
    $roots = [System.Collections.Generic.List[string]]::new()
    $files = [System.Collections.Generic.List[string]]::new()
    $denied = [System.Collections.Generic.List[string]]::new()
    $bytes = [int64]0
    $reparseSkipped = 0

    foreach ($pattern in $Target.Paths) {
        $resolved = Resolve-CleanupRoots -Pattern $pattern
        foreach ($rejected in $resolved.Rejected) { $denied.Add($rejected) }

        foreach ($root in $resolved.Roots) {
            if ($roots -notcontains $root) { $roots.Add($root) }

            if ($Target.Kind -eq "files") {
                # Single level by design: these targets are cache databases inside
                # one directory, not trees.
                $entries = @()
                try {
                    $entries = @([System.IO.Directory]::EnumerateFiles($root, $Target.Pattern))
                } catch {
                    $inventory.Warnings += "无法读取 $root"
                    continue
                }
                foreach ($entry in $entries) {
                    $info = Get-Item -LiteralPath $entry -Force -ErrorAction SilentlyContinue
                    if ($null -eq $info) { continue }
                    if (Test-ReparseItem $info) { $reparseSkipped++; continue }
                    if ($null -ne $cutoff -and $info.LastWriteTime -ge $cutoff) { continue }
                    $files.Add($entry)
                    $bytes += [int64]$info.Length
                }
            } else {
                $tree = Get-CleanupTreeFiles -Root $root -Filter $Target.Pattern
                $reparseSkipped += $tree.ReparseSkipped
                foreach ($file in $tree.Files) {
                    $info = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
                    if ($null -eq $info) { continue }
                    if ($null -ne $cutoff -and $info.LastWriteTime -ge $cutoff) { continue }
                    $files.Add($file)
                    $bytes += [int64]$info.Length
                }
            }
        }
    }

    $inventory.Roots = @($roots.ToArray())
    $inventory.Files = @($files.ToArray())
    $inventory.Bytes = $bytes
    $inventory.ReparseSkipped = $reparseSkipped
    $inventory.ContainmentDenied = @($denied.ToArray())

    if ($roots.Count -eq 0) {
        $inventory.Available = $false
        $inventory.SkippedReason = if ($denied.Count -gt 0) { "路径经过目录联接，已拒绝清理" } else { "目录不存在" }
    } elseif ($denied.Count -gt 0) {
        $inventory.Warnings += "跳过了 $($denied.Count) 个经过目录联接的路径"
        $inventory.SkippedReason = ""
    }

    return $inventory
}

# ---------------------------------------------------------------------------
# Plan persistence
#
# A plan is a newline separated list of absolute file paths plus a small JSON
# sidecar. The HTTP layer keeps it under the protected runtime directory, and
# apply re-validates every path against the declared root, so a tampered plan
# still cannot reach outside the catalog.
# ---------------------------------------------------------------------------

function Get-CleanupPlanPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$PlanId,
        [Parameter(Mandatory = $true)][string]$TargetId
    )

    if ($PlanId -notmatch '^[0-9a-f]{32}$') { throw "Invalid cleanup plan id" }
    if ($TargetId -notmatch '^[a-z0-9][a-z0-9-]{1,39}$') { throw "Invalid cleanup target id" }

    $planDir = Join-Path $Directory $PlanId
    [pscustomobject]@{
        Directory = $planDir
        Files     = Join-Path $planDir "$TargetId.files.txt"
        Meta      = Join-Path $planDir "$TargetId.meta.json"
    }
}

function Save-CleanupPlan {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$PlanId,
        [Parameter(Mandatory = $true)][string]$TargetId,
        [string[]]$Roots = @(),
        [string[]]$Files = @(),
        [int]$OlderThanDays = 1
    )

    $paths = Get-CleanupPlanPaths -Directory $Directory -PlanId $PlanId -TargetId $TargetId
    if (-not (Test-Path -LiteralPath $paths.Directory)) {
        New-Item -ItemType Directory -Path $paths.Directory -Force | Out-Null
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($paths.Files, [string[]]$Files, $encoding)

    $meta = [pscustomobject]@{
        planId        = $PlanId
        targetId      = $TargetId
        roots         = @($Roots)
        olderThanDays = $OlderThanDays
        fileCount     = $Files.Count
        createdAt     = (Get-Date).ToString("o")
    }
    [System.IO.File]::WriteAllText($paths.Meta, ($meta | ConvertTo-Json -Compress), $encoding)

    [pscustomobject]@{
        PlanId     = $PlanId
        Files      = $paths.Files
        Meta       = $paths.Meta
        FileCount  = $Files.Count
    }
}

<#
Loads a plan. Returns $null when the plan is missing, unreadable, expired, or
declared for a different target; the caller reports that as "stale" so the UI
asks for a new preview instead of deleting a different set of files.

The plan only carries the previewed file list. The allowed roots are re-derived
from the catalog by the caller, so a tampered plan cannot widen the scope.
#>
function Read-CleanupPlan {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$PlanId,
        [Parameter(Mandatory = $true)][string]$TargetId,
        [int]$MaxAgeMinutes = 30
    )

    try { $paths = Get-CleanupPlanPaths -Directory $Directory -PlanId $PlanId -TargetId $TargetId }
    catch { return $null }

    if (-not (Test-Path -LiteralPath $paths.Files) -or -not (Test-Path -LiteralPath $paths.Meta)) { return $null }

    $meta = $null
    try { $meta = Get-Content -LiteralPath $paths.Meta -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    if ($null -eq $meta) { return $null }

    $created = $null
    try { $created = [datetime]::Parse($meta.createdAt) } catch { return $null }
    if (((Get-Date) - $created).TotalMinutes -gt $MaxAgeMinutes) { return $null }

    if ([string]$meta.targetId -ne $TargetId) { return $null }

    $files = @()
    try { $files = [System.IO.File]::ReadAllLines($paths.Files) } catch { return $null }

    [pscustomobject]@{
        PlanId    = $PlanId
        TargetId  = $TargetId
        Roots     = @($meta.roots)
        Files     = @($files | Where-Object { $_ })
        CreatedAt = $created
    }
}

<#
Deletes exactly the files listed in $Plan, then prunes directories that became
empty. Every file must fall inside one of $AllowedRoots, which the caller derives
from the catalog; the plan's own root list is never trusted for authorization.
Each parent directory is validated once and cached, so a junction that appears
after the preview cannot be traversed.

Returns Status = ok | partial | failed.
#>
function Remove-CleanupPlanFiles {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string[]]$AllowedRoots
    )

    $failed = [System.Collections.Generic.List[string]]::new()
    $removed = [int64]0
    $bytes = [int64]0
    $verifiedDirectories = [System.Collections.Generic.Dictionary[string, bool]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $touchedDirectories = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $normalizedRoots = @($AllowedRoots | ForEach-Object {
        $value = Get-NormalizedCleanupPath $_
        if ($value) { $value.TrimEnd('\') }
    } | Where-Object { $_ })

    $findRoot = {
        param([string]$Path)
        foreach ($candidate in $normalizedRoots) {
            if ($Path.StartsWith($candidate + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $candidate }
        }
        return $null
    }

    foreach ($file in $Plan.Files) {
        $parent = [System.IO.Path]::GetDirectoryName($file)
        if ([string]::IsNullOrEmpty($parent)) { $failed.Add("$file : 路径无效"); continue }

        $root = & $findRoot $file
        if (-not $root) { $failed.Add("$file : 不在声明的清理范围内"); continue }

        if (-not $verifiedDirectories.ContainsKey($parent)) {
            $verifiedDirectories[$parent] = Test-CleanupPathContained -Path $parent -Root $root
        }
        if (-not $verifiedDirectories[$parent]) {
            $failed.Add("$file : 路径经过目录联接，已拒绝")
            continue
        }

        $info = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        if ($null -eq $info -or $info.PSIsContainer) { continue }
        if (Test-ReparseItem $info) { continue }

        try {
            $length = [int64]$info.Length
            Remove-Item -LiteralPath $file -Force -ErrorAction Stop
            $removed++
            $bytes += $length
            $null = $touchedDirectories.Add($parent)
        } catch {
            $failed.Add("$($info.Name) : $($_.Exception.Message)")
        }
    }

    # Prune only directories that are now empty, deepest first, never a root.
    $candidateDirs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in $touchedDirectories) {
        $root = & $findRoot $dir
        if (-not $root) { continue }
        $current = $dir
        while ($current -and $current.Length -gt $root.Length) {
            $null = $candidateDirs.Add($current)
            $parent = [System.IO.Path]::GetDirectoryName($current)
            if ([string]::IsNullOrEmpty($parent)) { break }
            $current = $parent
        }
    }
    $ordered = @($candidateDirs | Sort-Object -Property Length -Descending)
    foreach ($dir in $ordered) {
        $entries = $null
        try { $entries = @([System.IO.Directory]::EnumerateFileSystemEntries($dir)) } catch { continue }
        if ($entries.Count -ne 0) { continue }
        try { [System.IO.Directory]::Delete($dir, $false) } catch { }
    }

    $status = "ok"
    if ($failed.Count -gt 0) {
        $status = if ($removed -gt 0) { "partial" } else { "failed" }
    }

    [pscustomobject]@{
        Status       = $status
        RemovedFiles = $removed
        FreedBytes   = $bytes
        Failed       = @($failed | Select-Object -First 10)
        FailureCount = $failed.Count
    }
}

function Remove-CleanupPlanDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$PlanId
    )

    if ($PlanId -notmatch '^[0-9a-f]{32}$') { return }
    $planDir = Join-Path $Directory $PlanId
    if (Test-Path -LiteralPath $planDir) {
        Remove-Item -LiteralPath $planDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Export-ModuleMember -Function `
    Test-CleanupPathContained, `
    Get-CleanupTreeFiles, `
    Resolve-CleanupRoots, `
    Get-CleanupTargetInventory, `
    Get-CleanupPlanPaths, `
    Save-CleanupPlan, `
    Read-CleanupPlan, `
    Remove-CleanupPlanFiles, `
    Remove-CleanupPlanDirectory
