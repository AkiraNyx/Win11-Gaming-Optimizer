#Requires -Version 5.1

function New-OptimizationRestorePoint {
    [CmdletBinding()]
    param([string]$Description = "Win11Opt-PreApply")

    $failurePrefix = "System restore point was not created"
    if ($Description.Length -gt 100) { $Description = $Description.Substring(0, 100) }
    if ($Description -notmatch '^Win11Opt-') { $Description = "Win11Opt-$Description" }

    try {
        Enable-ComputerRestore -Drive "C:\" -ErrorAction SilentlyContinue
        $before = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SequenceNumber)
        $checkpointWarnings = @()
        Checkpoint-Computer -Description $Description -RestorePointType MODIFY_SETTINGS -ErrorAction Stop `
            -WarningAction SilentlyContinue -WarningVariable checkpointWarnings | Out-Null

        $created = $null
        for ($attempt = 0; $attempt -lt 3 -and -not $created; $attempt++) {
            $created = Get-ComputerRestorePoint -ErrorAction Stop |
                Where-Object { $_.Description -eq $Description -and $before -notcontains $_.SequenceNumber } |
                Sort-Object SequenceNumber -Descending | Select-Object -First 1
            if (-not $created -and $attempt -lt 2) { Start-Sleep -Milliseconds 500 }
        }
        if (-not $created) {
            $warningText = (@($checkpointWarnings) | ForEach-Object { [string]$_.Message }) -join " "
            if ($warningText -match '(?i)(1440|24\s*hours?)') {
                throw "$failurePrefix because another restore point was created within the last 24 hours"
            }
            if ($warningText) { throw "$failurePrefix`: $warningText" }
            throw "$failurePrefix because Windows did not report a newly created restore point"
        }

        return [PSCustomObject]@{
            Success = $true
            Message = "Restore point created: $Description (sequence $($created.SequenceNumber))"
            SequenceNumber = [int]$created.SequenceNumber
            Description = [string]$created.Description
        }
    } catch {
        $message = [string]$_.Exception.Message
        if ($message -notlike "$failurePrefix*") { $message = "$failurePrefix`: $message" }
        return [PSCustomObject]@{
            Success = $false
            Message = $message
            SequenceNumber = $null
            Description = $Description
        }
    }
}

function New-SystemRestore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$SequenceNumber,
        [string]$ExpectedDescription
    )

    try {
        $restorePoint = Get-ComputerRestorePoint -RestorePoint $SequenceNumber -ErrorAction Stop
        if (-not $restorePoint) { throw "Restore point sequence $SequenceNumber was not found" }
        if ([string]$restorePoint.Description -notmatch '^Win11Opt-') {
            throw "Restore point sequence $SequenceNumber was not created by Win11Optimizer"
        }
        if ($ExpectedDescription -and [string]$restorePoint.Description -ne $ExpectedDescription) {
            throw "Restore point description does not match the saved manifest"
        }

        Restore-Computer -RestorePoint $SequenceNumber -Confirm:$false -ErrorAction Stop
        return [PSCustomObject]@{ Success = $true; Message = "System restore started for sequence $SequenceNumber. Restart required." }
    } catch {
        return [PSCustomObject]@{ Success = $false; Message = "System restore failed: $($_.Exception.Message)" }
    }
}

Export-ModuleMember -Function New-OptimizationRestorePoint, New-SystemRestore
