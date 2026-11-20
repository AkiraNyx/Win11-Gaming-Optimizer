#Requires -Version 5.1
<#
Cleanup entry point.

  -Mode Scan   measure declared targets, write a preview plan, print one JSON object
  -Mode Apply  delete exactly the plan written by scan, print one JSON object

Scan is read-only. Apply never re-scans: it deletes the file list that the user
confirmed, and reports "stale" when that list is missing or expired, so the
preview and the deletion always describe the same set of files.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("Scan", "Apply")][string]$Mode,
    [string]$TargetIds = "",
    [int]$OlderThanDays = 1,
    [string]$LogDir,
    [string]$PlanDir,
    [string]$PlanId = "",
    [switch]$IncludeReportDetails
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

Import-Module (Join-Path $PSScriptRoot "CleanupCatalog.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "CleanupEngine.psm1") -Force

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

function Get-RecycleBinPaths {    $paths = [System.Collections.Generic.List[string]]::new()
    foreach ($volume in @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue)) {
        $binPath = Join-Path $volume.DeviceID '$Recycle.Bin'
        if (Test-Path -LiteralPath $binPath) { $paths.Add($binPath) }
    }
    return @($paths.ToArray())
}

function Measure-RecycleBin {
    $bytes = [int64]0
    $files = [int64]0
    foreach ($binPath in (Get-RecycleBinPaths)) {
        try {
            foreach ($sid in @(Get-ChildItem -LiteralPath $binPath -Directory -Force -ErrorAction Stop)) {
                $sum = (Get-ChildItem -LiteralPath $sid.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                        Measure-Object -Property Length -Sum)
                $bytes += [int64]($sum.Sum)
                $files += [int64]($sum.Count)
            }
        } catch {
            Write-CleanupLog "Recycle bin unreadable on $binPath ($($_.Exception.Message))" "WARN"
        }
    }
    [pscustomobject]@{ Bytes = $bytes; Files = $files }
}

$isAdmin = Test-IsAdministrator
$Targets = @()
if ($TargetIds) {
    $Targets = @($TargetIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if (-not $PlanDir) {
    $base = if ($LogDir) { $LogDir } else { $env:TEMP }
    $PlanDir = Join-Path $base "cleanup-plans"
}

Write-CleanupLog "Cleanup engine started: mode=$Mode admin=$isAdmin olderThanDays=$OlderThanDays planDir=$PlanDir"

# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------
function Invoke-CleanupScan {
    param([object[]]$Scope, [int]$Days, [bool]$IsAdmin, [string]$PlansDirectory)

    # Plans are preview artifacts; keep a day of them and drop the rest so the
    # directory cannot grow without bound across sessions.
    if (Test-Path -LiteralPath $PlansDirectory) {
        Get-ChildItem -LiteralPath $PlansDirectory -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-24) } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    $planId = [guid]::NewGuid().ToString("N")
    $results = [System.Collections.Generic.List[object]]::new()
    $totalBytes = [int64]0
    $totalFiles = [int64]0
    $inventoryBytes = [int64]0

    foreach ($target in $Scope) {
        $available = $true
        $skippedReason = ""
        $bytes = [int64]0
        $files = [int64]0
        $roots = @()
        $details = @()
        $warnings = @()

        if ($target.Kind -eq "report") {
            $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays $Days -IsAdmin $IsAdmin
            $bytes = $inventory.Bytes
            $roots = $inventory.Roots
            $warnings = $inventory.Warnings
            if (-not $inventory.Available) { $available = $false; $skippedReason = $inventory.SkippedReason }
            if ($IncludeReportDetails -or $target.Kind -eq "report") {
                $details = @(Get-ReportDetails -Target $target)
            }
            $inventoryBytes += $bytes
        } elseif ($target.Kind -eq "recyclebin") {
            if ($target.RequiresAdmin -and -not $IsAdmin) {
                $available = $false
                $skippedReason = "需要管理员权限"
            } else {
                $measured = Measure-RecycleBin
                $bytes = $measured.Bytes
                $files = $measured.Files
                $roots = @(Get-RecycleBinPaths)
                $null = Save-CleanupPlan -Directory $PlansDirectory -PlanId $planId -TargetId $target.Id `
                    -Roots $roots -Files @() -OlderThanDays $Days
            }
            $totalBytes += $bytes
            $totalFiles += $files
        } else {
            $inventory = Get-CleanupTargetInventory -Target $target -OlderThanDays $Days -IsAdmin $IsAdmin
            $bytes = $inventory.Bytes
            $files = $inventory.Files.Count
            $roots = $inventory.Roots
            $warnings = $inventory.Warnings
            if (-not $inventory.Available) { $available = $false; $skippedReason = $inventory.SkippedReason }

            if ($available) {
                $null = Save-CleanupPlan -Directory $PlansDirectory -PlanId $planId -TargetId $target.Id `
                    -Roots $roots -Files $inventory.Files -OlderThanDays $Days
            }
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
            paths           = @($roots)
            entries         = @($details)
            warnings        = @($warnings)
            note            = $target.Note
        }) | Out-Null

        Write-CleanupLog "$($target.Id): $([math]::Round($bytes/1MB,1)) MB / $files files (available=$available)"
    }

    [pscustomobject]@{
        mode           = "scan"
        scannedAt      = (Get-Date).ToString("o")
        isAdmin        = $IsAdmin
        olderThanDays  = $Days
        planId         = $planId
        totalBytes     = $totalBytes
        totalFiles     = $totalFiles
        inventoryBytes = $inventoryBytes
        targets        = @($results.ToArray())
    }
}

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
function Invoke-CleanupApply {
    param([object[]]$Scope, [int]$Days, [bool]$IsAdmin, [string]$PlansDirectory, [string]$RequestedPlanId)

    $results = [System.Collections.Generic.List[object]]::new()
    $freedBytes = [int64]0
    $removedFiles = [int64]0
    $failureCount = 0

    foreach ($target in $Scope) {
        $status = "ok"
        $reason = ""
        $bytes = [int64]0
        $files = [int64]0
        $failed = @()

        if ($target.Kind -eq "report") {
            $results.Add([pscustomobject]@{ id = $target.Id; status = "skipped"; reason = "只读盘点项，不执行删除"; freedBytes = 0; removedFiles = 0; failed = @() }) | Out-Null
            continue
        }
        if ($target.RequiresAdmin -and -not $IsAdmin) {
            $results.Add([pscustomobject]@{ id = $target.Id; status = "skipped"; reason = "需要管理员权限"; freedBytes = 0; removedFiles = 0; failed = @() }) | Out-Null
            continue
        }

        if ($target.Kind -eq "recyclebin") {
            $plan = Read-CleanupPlan -Directory $PlansDirectory -PlanId $RequestedPlanId -TargetId $target.Id
            if ($null -eq $plan) {
                $status = "stale"
                $reason = "预览清单已失效，请重新扫描后再清理"
            } else {
                $before = Measure-RecycleBin
                try {
                    Clear-RecycleBin -Force -ErrorAction Stop
                    $bytes = $before.Bytes
                    $files = $before.Files
                } catch {
                    $status = "failed"
                    $reason = $_.Exception.Message
                }
            }
        } else {
            $plan = Read-CleanupPlan -Directory $PlansDirectory -PlanId $RequestedPlanId -TargetId $target.Id
            if ($null -eq $plan) {
                $status = "stale"
                $reason = "预览清单已失效，请重新扫描后再清理"
            } else {
                # Allowed roots come from the catalog, never from the plan file.
                $allowed = [System.Collections.Generic.List[string]]::new()
                foreach ($pattern in $target.Paths) {
                    foreach ($root in (Resolve-CleanupRoots -Pattern $pattern).Roots) {
                        if ($allowed -notcontains $root) { $allowed.Add($root) }
                    }
                }

                if ($allowed.Count -eq 0) {
                    if ($plan.Files.Count -gt 0) {
                        $status = "skipped"
                        $reason = "目录已不存在，无可清理内容"
                    }
                } else {
                    $removal = Remove-CleanupPlanFiles -Plan $plan -AllowedRoots @($allowed.ToArray())
                    $status = $removal.Status
                    $bytes = $removal.FreedBytes
                    $files = $removal.RemovedFiles
                    $failed = $removal.Failed
                    if ($status -eq "partial") { $reason = "$($removal.FailureCount) 个文件未能删除（多为被占用）" }
                    elseif ($status -eq "failed") { $reason = "全部文件删除失败" }
                }
            }
        }

        if ($status -eq "partial" -or $status -eq "failed") { $failureCount++ }

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
        planId        = $RequestedPlanId
        freedBytes    = $freedBytes
        removedFiles  = $removedFiles
        failureCount  = $failureCount
        results       = @($results.ToArray())
    }
}

# ---------------------------------------------------------------------------

$selection = $null
if ($Mode -eq "Apply") {
    if (-not $Targets -or $Targets.Count -eq 0) { throw "Apply requires at least one target id" }
    if (-not $PlanId -or $PlanId -notmatch '^[0-9a-f]{32}$') { throw "Apply requires a valid plan id" }
    $selection = Get-CleanupTargetById -Ids $Targets
    if ($selection.Unknown.Count -gt 0) { throw "Unknown cleanup target: $($selection.Unknown -join ', ')" }
    $scope = $selection.Targets
} else {
    $scope = @(Get-CleanupCatalog)
    if ($Targets -and $Targets.Count -gt 0) {
        $selection = Get-CleanupTargetById -Ids $Targets
        if ($selection.Unknown.Count -gt 0) { throw "Unknown cleanup target: $($selection.Unknown -join ', ')" }
        $scope = $selection.Targets
    }
}

$result = if ($Mode -eq "Scan") {
    Invoke-CleanupScan -Scope $scope -Days $OlderThanDays -IsAdmin $isAdmin -PlansDirectory $PlanDir
} else {
    Invoke-CleanupApply -Scope $scope -Days $OlderThanDays -IsAdmin $isAdmin -PlansDirectory $PlanDir -RequestedPlanId $PlanId
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
