#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-BootOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "Boot Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "fastStartup") {
        $fastStartupEnabled = [bool](Get-ConfigItemTarget $Config "bootOptimization" "fastStartup")
        $hibernationEnabled = [bool](Get-ConfigItemTarget $Config "storageOptimization" "disableHibernation")
        if ($fastStartupEnabled -and -not $hibernationEnabled) {
            throw "Fast startup cannot be enabled while hibernation is disabled"
        }
        if ($fastStartupEnabled) {
            Set-TrackedHibernation -Enabled $true -Description "Enable hibernation support for fast startup" | Out-Null
            Set-RegistryValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name "HiberbootEnabled" -Value 1 -Type DWord -Description "Enable fast startup" | Out-Null
        } else {
            Set-RegistryValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name "HiberbootEnabled" -Value 0 -Type DWord -Description "Disable fast startup" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableBootLog") {
        $bootLogEnabled = [bool](Get-ConfigItemTarget $Config "bootOptimization" "disableBootLog")
        $bootLogValue = if ($bootLogEnabled) { "Yes" } else { "No" }
        Set-TrackedBcdElement -Identifier "{current}" -Element "bootlog" -Value $bootLogValue -Description "Set boot logging target" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "reduceBootTimeout") {
        $bootTimeout = Get-ConfigItemTarget $Config "bootOptimization" "reduceBootTimeout"
        if ($bootTimeout -eq "systemDefault") {
            Remove-TrackedBcdElement -Identifier "{bootmgr}" -Element "timeout" -Description "Restore default boot menu timeout" | Out-Null
        } else {
            Set-TrackedBcdElement -Identifier "{bootmgr}" -Element "timeout" -Value ([string]$bootTimeout) -Description "Set boot menu timeout" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableStartupSound") {
        $startupSoundEnabled = [bool](Get-ConfigItemTarget $Config "bootOptimization" "disableStartupSound")
        $startupSoundValue = if ($startupSoundEnabled) { 0 } else { 1 }
        Set-RegistryValue -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI\BootAnimation" -Name "DisableStartupSound" -Value $startupSoundValue -Type DWord -Description "Set startup sound target" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "bootProcessorsFull") {
        if (Test-ConfigItemCommand $Config "bootOptimization" "bootProcessorsFull") {
            # Windows already uses every available processor unless numproc limits it.
            Remove-TrackedBcdElement -Identifier "{current}" -Element "numproc" -Description "Remove boot processor limit" | Out-Null
        }
    }
}
