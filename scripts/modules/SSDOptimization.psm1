#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-SSDOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "SSD Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "enableTrim") {
        $trimEnabled = [bool](Get-ConfigItemTarget $Config "ssdOptimization" "enableTrim")
        $trimValue = if ($trimEnabled) { 0 } else { 1 }
        foreach ($fileSystem in @("NTFS", "ReFS")) {
            Set-TrackedFsutilBehavior -Behavior "DisableDeleteNotify" -FileSystem $fileSystem -Value $trimValue -Description "Set $fileSystem TRIM notification target" | Out-Null
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disablePrefetch") {
        $prefetchTarget = Get-ConfigItemTarget $Config "ssdOptimization" "disablePrefetch"
        $prefetchPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters"
        if ($prefetchTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $prefetchPath -Name "EnablePrefetcher" -Description "Restore default prefetch behavior" | Out-Null
            Remove-RegistryValue -Path $prefetchPath -Name "EnableSuperfetch" -Description "Restore default superfetch behavior" | Out-Null
        } elseif ($prefetchTarget -eq "disabled") {
            Set-RegistryValue -Path $prefetchPath -Name "EnablePrefetcher" -Value 0 -Type DWord -Description "Disable prefetcher" | Out-Null
            Set-RegistryValue -Path $prefetchPath -Name "EnableSuperfetch" -Value 0 -Type DWord -Description "Disable superfetch" | Out-Null
        } else {
            Set-RegistryValue -Path $prefetchPath -Name "EnablePrefetcher" -Value 3 -Type DWord -Description "Enable prefetcher" | Out-Null
            Set-RegistryValue -Path $prefetchPath -Name "EnableSuperfetch" -Value 3 -Type DWord -Description "Enable superfetch" | Out-Null
        }
    }
}
