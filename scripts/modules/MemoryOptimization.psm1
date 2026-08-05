#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-MemoryOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "Memory Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableMemoryCompression") {
        $memoryCompressionTarget = [bool](Get-ConfigItemTarget $Config "memoryOptimization" "disableMemoryCompression")
        $ram = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB
        if (-not $memoryCompressionTarget -and $ram -lt 16) {
            throw "Disabling memory compression requires at least 16 GB of RAM"
        }
        $memoryCompressionEnabled = [bool](Get-MMAgent -ErrorAction Stop).MemoryCompression
        if ($memoryCompressionEnabled -ne $memoryCompressionTarget) {
            $changeId = Register-OptimizationChange -Kind "MemoryCompression" -Target "MMAgent" -OriginalValue $memoryCompressionEnabled -NewValue $memoryCompressionTarget -Description "Set memory compression target"
            if ($memoryCompressionTarget) {
                Complete-TrackedOperation -ChangeId $changeId -Action { Enable-MMAgent -MemoryCompression -ErrorAction Stop }
            } else {
                Complete-TrackedOperation -ChangeId $changeId -Action { Disable-MMAgent -MemoryCompression -ErrorAction Stop }
            }
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableCrashDump") {
        $crashDumpTarget = Get-ConfigItemTarget $Config "memoryOptimization" "disableCrashDump"
        $crashPath = "HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl"
        if ($crashDumpTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $crashPath -Name "CrashDumpEnabled" -Description "Restore default crash dump mode" | Out-Null
        } else {
            Set-RegistryValue -Path $crashPath -Name "CrashDumpEnabled" -Value ([int]$crashDumpTarget) -Type DWord -Description "Set crash dump mode" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "largeSystemCache") {
        $cacheTarget = Get-ConfigItemTarget $Config "memoryOptimization" "largeSystemCache"
        $cacheValue = if ($cacheTarget -eq "server") { 1 } else { 0 }
        Set-RegistryValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" -Name "LargeSystemCache" -Value $cacheValue -Type DWord -Description "Set system cache policy" | Out-Null
    }
}
