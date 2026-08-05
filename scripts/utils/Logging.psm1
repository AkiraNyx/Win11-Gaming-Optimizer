#Requires -Version 5.1

$Script:LogStateKey = "Win11Optimizer.Logging.v1"

function Get-SharedLogState {
    $state = [AppDomain]::CurrentDomain.GetData($Script:LogStateKey)
    if ($null -eq $state) {
        $state = [PSCustomObject]@{ LogFile = $null; LogLevel = "INFO" }
        [AppDomain]::CurrentDomain.SetData($Script:LogStateKey, $state)
    }
    return $state
}

function Initialize-Log {
    [CmdletBinding()]
    param(
        [string]$LogDirectory,
        [string]$LogLevel = "INFO"
    )
    $state = Get-SharedLogState
    $state.LogLevel = $LogLevel
    if (-not $LogDirectory) { $LogDirectory = Join-Path $PSScriptRoot "..\.." }
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss_fff"
    $state.LogFile = Join-Path $LogDirectory "optimization_$($timestamp)_$PID.log"
    if (-not (Test-Path $LogDirectory)) { New-Item -Path $LogDirectory -ItemType Directory -Force | Out-Null }
    Write-LogEntry -Message "=== Windows 11 Gaming Optimization Log ===" -Level "INFO"
    Write-LogEntry -Message "Log file: $($state.LogFile)" -Level "INFO"
}

function Write-LogEntry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet("INFO","WARN","ERROR","SUCCESS","DEBUG")][string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    $color = switch ($Level) { "INFO" {"White"} "WARN" {"Yellow"} "ERROR" {"Red"} "SUCCESS" {"Green"} default {"White"} }
    $levelOrder = @{ "DEBUG"=0; "INFO"=1; "WARN"=2; "ERROR"=3; "SUCCESS"=1 }
    $state = Get-SharedLogState
    if ($levelOrder[$Level] -ge $levelOrder[$state.LogLevel]) {
        Write-Host $logEntry -ForegroundColor $color
    }
    if ($state.LogFile) {
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        $sw = [System.IO.StreamWriter]::new($state.LogFile, $true, $utf8NoBom)
        try { $sw.WriteLine($logEntry) } finally { $sw.Close() }
    }
}

function Write-LogSection {
    param([Parameter(Mandatory = $true)][string]$SectionName)
    $sep = "=" * 60
    Write-LogEntry -Message $sep
    Write-LogEntry -Message "  $SectionName"
    Write-LogEntry -Message $sep
}

function Write-LogItem {
    param(
        [Parameter(Mandatory = $true)][string]$ItemName,
        [string]$Description = "",
        [ValidateSet("INFO","WARN","ERROR","SUCCESS","SKIP")][string]$Status = "INFO"
    )
    $icon = switch ($Status) { "INFO" {"[*]"} "WARN" {"[!]"} "ERROR" {"[X]"} "SUCCESS" {"[OK]"} "SKIP" {"[-]"} default {"[*]"} }
    $logLevel = if ($Status -eq "SKIP") { "INFO" } else { $Status }
    $msg = if ($Description) { "$icon $ItemName - $Description" } else { "$icon $ItemName" }
    Write-LogEntry -Message $msg -Level $logLevel
}

function Get-LogFilePath { return (Get-SharedLogState).LogFile }

Export-ModuleMember -Function Initialize-Log, Write-LogEntry, Write-LogSection, Write-LogItem, Get-LogFilePath
