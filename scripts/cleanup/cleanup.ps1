#Requires -Version 5.1
<#
Cleanup engine.

  -Mode Scan   measure declared cleanup targets, print one JSON object
  -Mode Apply  delete the selected targets, print one JSON object

Only target ids declared in CleanupCatalog.psm1 are accepted. No caller supplied
path ever reaches the filesystem. Directory entries that are reparse points are
never followed or removed. Directory roots are preserved: only their contents go.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("Scan", "Apply")][string]$Mode,
    [string]$TargetIds = "",
    [int]$OlderThanDays = 1,
    [string]$LogDir,
    [switch]$IncludeReportDetails
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$catalogPath = Join-Path $PSScriptRoot "CleanupCatalog.psm1"
Import-Module $catalogPath -Force

$script:LogLines = [System.Collections.Generic.List[string]]::new()
function Write-CleanupLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    $script:LogLines.Add($line)
}

function Test-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Expand-CleanupPath {
    param([Parameter(Mandatory = $true)][string]$Pattern)

    if (-not [System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($Pattern)) {
        if (Test-Path -LiteralPath $Pattern -PathType Container) { return @((Get-Item -LiteralPath $Pattern).FullName) }
        return @()
    }

    $results = @()
    try {
        $results = @(Get-Item -Path $Pattern -ErrorAction SilentlyContinue |
                     Where-Object { $_.PSIsContainer } |
                     ForEach-Object { $_.FullName })
    } catch {
        Write-CleanupLog "Path expansion failed: $Pattern ($($_.Exception.Message))" "WARN"
    }
    return $results
}

function Get-CleanupCandidates {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][int]$Days
    )

    $candidates = [System.Collections.Generic.List[object]]::new()
    $paths = [System.Collections.Generic.List[string]]::new()
    # Windows paths are case-insensitive: AMD\DxCache and AMD\DxcCache are the
    # same directory, so de-duplicate on a normalized key or the same bytes get
    # counted (and later deleted) twice.
    $seenPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $reparseSkipped = 0

    foreach ($root in $Target.Paths) {
        foreach ($dir in (Expand-CleanupPath -Pattern $root)) {
            if ($seenPaths.Add($dir)) { $paths.Add($dir) }
            $entries = @()
            try {
                if ($Target.Kind -eq "files") {
                    $entries = @(Get-ChildItem -LiteralPath $dir -Filter $Target.Pattern -File -Force -ErrorAction Stop)
                } else {
                    $entries = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)
                }
            } catch {
                Write-CleanupLog "Unreadable directory: $dir ($($_.Exception.Message))" "WARN"
                continue
            }
            foreach ($entry in $entries) {
                if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    $reparseSkipped++
                    continue
                }
                $candidates.Add($entry)
            }
        }
    }

    $selected = $candidates
    if ($Days -ge 0) {
        $cutoff = (Get-Date).AddDays(-$Days)
        $selected = @($candidates | Where-Object { $_.LastWriteTime -lt $cutoff })
    }

    [pscustomobject]@{
        Candidates     = @($selected)
        Paths          = @($paths)
        ReparseSkipped = $reparseSkipped
    }
}

function Measure-EntryBytes {
    param([Parameter(Mandatory = $true)]$Entry)

    if ($Entry.PSIsContainer) {
        try {
            $sum = (Get-ChildItem -LiteralPath $Entry.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum
            if ($null -eq $sum) { return 0 }
            return [int64]$sum
        } catch {
            return [int64]0
        }
    }
    return [int64]$Entry.Length
}

function Get-ReportDetails {
    param([Parameter(Mandatory = $true)]$Target, [int]$Limit = 25)

    switch ($Target.Id) {
        "stale-installers" {
            $downloads = @($Target.Paths)[0]
            if (-not (Test-Path -LiteralPath $downloads)) { return @() }
            $extensions = @(".exe", ".msi", ".msu", ".zip", ".7z", ".rar", ".iso")
            $files = @(Get-ChildItem -LiteralPath $downloads -File -Force -ErrorAction SilentlyContinue |
                       Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() -and $_.Length -ge 100MB } |
                       Sort-Object Length -Descending |
                       Select-Object -First $Limit)
            return @($files | ForEach-Object {
                [pscustomobject]@{
                    Name  = $_.Name
                    Bytes = [int64]$_.Length
                    Date  = $_.LastWriteTime.ToString("yyyy-MM-dd")
                }
            })
        }
        default {
            return @()
        }
    }
}

function Invoke-CleanupScan {
    param([Parameter(Mandatory = $true)][object[]]$Scope, [Parameter(Mandatory = $true)][int]$Days, [bool]$IsAdmin)

    $results = [System.Collections.Generic.List[object]]::new()
    $totalBytes = [int64]0
    $totalFiles = [int64]0
    # Read-only inventory is reported separately: it is never part of the
    # reclaimable total, or the UI would promise space it cannot free.
    $inventoryBytes = [int64]0

    foreach ($target in $Scope) {
        $available = $true
        $skippedReason = ""
        $bytes = [int64]0
        $files = [int64]0
        $paths = @()
        $details = @()

        if ($target.RequiresAdmin -and -not $IsAdmin) {
            $available = $false
            $skippedReason = "需要管理员权限才能读取"
        } elseif ($target.Kind -eq "recyclebin") {
            $paths = @()
            foreach ($volume in @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue)) {
                $binPath = Join-Path $volume.DeviceID '$Recycle.Bin'
                if (Test-Path -LiteralPath $binPath) { $paths += $binPath }
            }
            foreach ($p in $paths) {
                try {
                    foreach ($sid in @(Get-ChildItem -LiteralPath $p -Directory -Force -ErrorAction Stop)) {
                        $sum = (Get-ChildItem -LiteralPath $sid.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                                Measure-Object -Property Length -Sum)
                        $bytes += [int64]($sum.Sum)
                        $files += [int64]($sum.Count)
                    }
                } catch {
                    Write-CleanupLog "Recycle bin unreadable on $p ($($_.Exception.Message))" "WARN"
                }
            }
        } else {
            $scan = Get-CleanupCandidates -Target $target -Days $Days
            $paths = $scan.Paths
            if ($scan.Paths.Count -eq 0) {
                $available = $false
                $skippedReason = "目录不存在"
            }
            if ($scan.ReparseSkipped -gt 0) {
                Write-CleanupLog "$($target.Id): skipped $($scan.ReparseSkipped) reparse point entries" "INFO"
            }
            foreach ($entry in $scan.Candidates) {
                $bytes += (Measure-EntryBytes -Entry $entry)
                if ($entry.PSIsContainer) {
                    $count = (Get-ChildItem -LiteralPath $entry.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count
                    $files += [int64]$count
                } else {
                    $files += 1
                }
            }
            if ($IncludeReportDetails -or $target.Kind -eq "report") {
                $details = @(Get-ReportDetails -Target $target)
            }
        }

        if ($target.Kind -eq "report") {
            $inventoryBytes += $bytes
        } else {
            $totalBytes += $bytes
            $totalFiles += $files
        }

        $results.Add([pscustomobject]@{
            id              = $target.Id
            group           = $target.Group
            label           = $target.Label
            description     = $target.Description
            risk            = $target.Risk
            kind            = $target.Kind
            requiresAdmin   = $target.RequiresAdmin
            defaultSelected = $target.DefaultSelected
            available       = $available
            skippedReason   = $skippedReason
            bytes           = $bytes
            files           = $files
            paths           = @($paths)
            entries         = @($details)
            note            = $target.Note
        }) | Out-Null

        Write-CleanupLog "$($target.Id): $([math]::Round($bytes/1MB,1)) MB / $files files (available=$available)"
    }

    [pscustomobject]@{
        mode          = "scan"
        scannedAt     = (Get-Date).ToString("o")
        isAdmin       = $IsAdmin
        olderThanDays = $Days
        totalBytes    = $totalBytes
        totalFiles    = $totalFiles
        inventoryBytes = $inventoryBytes
        targets       = @($results.ToArray())
    }
}

function Invoke-CleanupApply {
    param([Parameter(Mandatory = $true)][object[]]$Scope, [Parameter(Mandatory = $true)][int]$Days, [bool]$IsAdmin)

    $results = [System.Collections.Generic.List[object]]::new()
    $freedBytes = [int64]0
    $removedFiles = [int64]0
    $failureCount = 0

    foreach ($target in $Scope) {
        $status = "ok"
        $reason = ""
        $bytes = [int64]0
        $files = [int64]0
        $failed = [System.Collections.Generic.List[string]]::new()

        if ($target.Kind -eq "report") {
            $results.Add([pscustomobject]@{ id = $target.Id; status = "skipped"; reason = "只读盘点项，不执行删除"; freedBytes = 0; removedFiles = 0; failed = @() }) | Out-Null
            continue
        }
        if ($target.RequiresAdmin -and -not $IsAdmin) {
            $results.Add([pscustomobject]@{ id = $target.Id; status = "skipped"; reason = "需要管理员权限"; freedBytes = 0; removedFiles = 0; failed = @() }) | Out-Null
            continue
        }

        try {
            if ($target.Kind -eq "recyclebin") {
                $before = [int64]0
                $beforeFiles = [int64]0
                foreach ($volume in @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue)) {
                    $binPath = Join-Path $volume.DeviceID '$Recycle.Bin'
                    if (-not (Test-Path -LiteralPath $binPath)) { continue }
                    foreach ($sid in @(Get-ChildItem -LiteralPath $binPath -Directory -Force -ErrorAction SilentlyContinue)) {
                        $sum = (Get-ChildItem -LiteralPath $sid.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                                Measure-Object -Property Length -Sum)
                        $before += [int64]($sum.Sum)
                        $beforeFiles += [int64]($sum.Count)
                    }
                }
                Clear-RecycleBin -Force -ErrorAction Stop
                $bytes = $before
                $files = $beforeFiles
            } else {
                $scan = Get-CleanupCandidates -Target $target -Days $Days
                foreach ($entry in $scan.Candidates) {
                    try {
                        $size = Measure-EntryBytes -Entry $entry
                        $count = if ($entry.PSIsContainer) {
                            (Get-ChildItem -LiteralPath $entry.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count
                        } else { 1 }
                        Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
                        $bytes += [int64]$size
                        $files += [int64]$count
                    } catch {
                        $failed.Add("$($entry.Name): $($_.Exception.Message)")
                    }
                }
            }
        } catch {
            $status = "failed"
            $reason = $_.Exception.Message
        }

        if ($failed.Count -gt 0) {
            $status = "partial"
            $reason = "$($failed.Count) 个条目删除失败（多为被占用）"
            $failureCount++
        }

        $freedBytes += $bytes
        $removedFiles += $files
        $results.Add([pscustomobject]@{
            id           = $target.Id
            status       = $status
            reason       = $reason
            freedBytes   = $bytes
            removedFiles = $files
            failed       = @($failed | Select-Object -First 10)
        }) | Out-Null

        Write-CleanupLog "$($target.Id): $status, freed $([math]::Round($bytes/1MB,1)) MB, $files files, failures=$($failed.Count)"
    }

    [pscustomobject]@{
        mode          = "apply"
        finishedAt    = (Get-Date).ToString("o")
        isAdmin       = $IsAdmin
        olderThanDays = $Days
        freedBytes    = $freedBytes
        removedFiles  = $removedFiles
        failureCount  = $failureCount
        results       = @($results.ToArray())
    }
}

# ---------------------------------------------------------------------------

$isAdmin = Test-IsAdministrator
Write-CleanupLog "Cleanup engine started: mode=$Mode admin=$isAdmin olderThanDays=$OlderThanDays"

# A comma separated string keeps the Node -> PowerShell hand-off unambiguous:
# passing "a,b" to a [string[]] parameter would bind a single element.
$Targets = @()
if ($TargetIds) {
    $Targets = @($TargetIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$selection = $null
if ($Mode -eq "Apply") {
    if (-not $Targets -or $Targets.Count -eq 0) {
        throw "Apply requires at least one target id"
    }
    $selection = Get-CleanupTargetById -Ids $Targets
    if ($selection.Unknown.Count -gt 0) {
        throw "Unknown cleanup target: $($selection.Unknown -join ', ')"
    }
    $scope = $selection.Targets
} else {
    $scope = @(Get-CleanupCatalog)
    if ($Targets -and $Targets.Count -gt 0) {
        $selection = Get-CleanupTargetById -Ids $Targets
        if ($selection.Unknown.Count -gt 0) {
            throw "Unknown cleanup target: $($selection.Unknown -join ', ')"
        }
        $scope = $selection.Targets
    }
}

$result = if ($Mode -eq "Scan") {
    Invoke-CleanupScan -Scope $scope -Days $OlderThanDays -IsAdmin $isAdmin
} else {
    Invoke-CleanupApply -Scope $scope -Days $OlderThanDays -IsAdmin $isAdmin
}

if ($LogDir) {
    try {
        if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        $logPath = Join-Path $LogDir ("cleanup_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
        $script:LogLines | Set-Content -LiteralPath $logPath -Encoding UTF8
        $result | Add-Member -NotePropertyName logFile -NotePropertyValue $logPath -Force
    } catch {
        # Logging must never hide the result.
    }
}

$result | ConvertTo-Json -Depth 6 -Compress
