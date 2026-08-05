#Requires -Version 5.1

$Script:OptimizerMutationMutexName = "Global\Win11Optimizer.SystemMutation.v2"
$Script:AllowedNativeCommands = @("reg.exe", "powercfg.exe", "bcdedit.exe", "fsutil.exe", "sc.exe")

function Test-ProcessAdministrator {
    [CmdletBinding()]
    param()

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-CheckedNativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int[]]$AllowedExitCodes = @(0),
        [switch]$AllowMissingCommand
    )

    if ([IO.Path]::GetFileName($FilePath) -ne $FilePath -or $Script:AllowedNativeCommands -notcontains $FilePath) {
        throw "Native command is not allowed: $FilePath"
    }

    $systemDirectory = [Environment]::SystemDirectory
    if ([string]::IsNullOrWhiteSpace($systemDirectory) -or -not [IO.Path]::IsPathRooted($systemDirectory)) {
        throw "Unable to resolve the trusted Windows system directory"
    }
    $commandPath = [IO.Path]::Combine([IO.Path]::GetFullPath($systemDirectory), $FilePath.ToLowerInvariant())
    if (-not [IO.File]::Exists($commandPath)) {
        if ($AllowMissingCommand) {
            return [PSCustomObject]@{ Success = $false; ExitCode = $null; Output = @(); Command = $commandPath }
        }
        throw "Required command was not found: $commandPath"
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $commandPath @ArgumentList 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($AllowedExitCodes -notcontains $exitCode) {
        $renderedArguments = $ArgumentList -join " "
        $details = ($output | ForEach-Object { $_.ToString() }) -join " | "
        throw "Native command failed (exit $exitCode): $commandPath $renderedArguments. $details"
    }

    return [PSCustomObject]@{
        Success = $true
        ExitCode = $exitCode
        Output = $output
        Command = $commandPath
    }
}

function Get-GuidFromText {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$InputObject)

    $text = (@($InputObject) | ForEach-Object { $_.ToString() }) -join "`n"
    $match = [regex]::Match($text, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')
    if (-not $match.Success) { return $null }
    return $match.Value.ToLowerInvariant()
}

function Enter-OptimizerMutationLock {
    [CmdletBinding()]
    param([ValidateRange(0, 600000)][int]$TimeoutMilliseconds = 0)

    $mutex = $null
    $acquired = $false
    try {
        $mutex = [System.Threading.Mutex]::new($false, $Script:OptimizerMutationMutexName)
        try {
            $acquired = $mutex.WaitOne($TimeoutMilliseconds)
        } catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            throw "Another optimizer operation is already modifying system settings"
        }
        return [PSCustomObject]@{
            Name = $Script:OptimizerMutationMutexName
            Mutex = $mutex
            Acquired = $true
        }
    } catch {
        if ($mutex -and -not $acquired) { $mutex.Dispose() }
        throw
    }
}

function Exit-OptimizerMutationLock {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lock)

    if ($null -eq $Lock.Mutex) { return }
    try {
        if ([bool]$Lock.Acquired) { $Lock.Mutex.ReleaseMutex() }
    } finally {
        $Lock.Mutex.Dispose()
        $Lock.Acquired = $false
    }
}

Export-ModuleMember -Function Test-ProcessAdministrator, Invoke-CheckedNativeCommand, Get-GuidFromText, Enter-OptimizerMutationLock, Exit-OptimizerMutationLock
