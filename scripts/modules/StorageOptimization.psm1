#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force
Import-Module (Join-Path $Script:UtilsPath "Service.psm1") -Force

function Enable-TrackedAutomaticPagefile {
    $computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    if ([bool]$computerSystem.AutomaticManagedPagefile) { return $false }

    $settings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{
            Name = [string]$_.Name
            InitialSize = [uint32]$_.InitialSize
            MaximumSize = [uint32]$_.MaximumSize
        }
    })
    $original = [PSCustomObject]@{
        AutomaticManagedPagefile = $false
        Settings = $settings
    }
    $newValue = [PSCustomObject]@{ AutomaticManagedPagefile = $true; Settings = @() }
    $changeId = Register-OptimizationChange -Kind "PageFileConfiguration" -Target "Win32_ComputerSystem" -OriginalValue $original -NewValue $newValue -Description "Enable a system-managed page file"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        $computerSystem | Set-CimInstance -Property @{ AutomaticManagedPagefile = $true } -ErrorAction Stop | Out-Null
    }
    return $true
}

function Disable-TrackedPagefile {
    $computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $settings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{ Name = [string]$_.Name; InitialSize = [uint32]$_.InitialSize; MaximumSize = [uint32]$_.MaximumSize }
    })
    if (-not [bool]$computerSystem.AutomaticManagedPagefile -and $settings.Count -eq 0) { return $false }
    $original = [PSCustomObject]@{ AutomaticManagedPagefile = [bool]$computerSystem.AutomaticManagedPagefile; Settings = $settings }
    $changeId = Register-OptimizationChange -Kind "PageFileConfiguration" -Target "Win32_ComputerSystem" -OriginalValue $original -NewValue "disabled" -Description "Disable the page file"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        $computerSystem | Set-CimInstance -Property @{ AutomaticManagedPagefile = $false } -ErrorAction Stop | Out-Null
        foreach ($setting in @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)) {
            Remove-CimInstance -InputObject $setting -ErrorAction Stop
        }
    }
    return $true
}

function Invoke-StorageOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "Storage Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableLastAccess") {
        $lastAccessTarget = [int](Get-ConfigItemTarget $Config "storageOptimization" "disableLastAccess")
        Set-TrackedFsutilBehavior -Behavior "disablelastaccess" -Value $lastAccessTarget -Description "Set NTFS last-access behavior" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableDot3Name") {
        $dot3Target = [int](Get-ConfigItemTarget $Config "storageOptimization" "disableDot3Name")
        Set-TrackedFsutilBehavior -Behavior "disable8dot3" -Value $dot3Target -Description "Set 8.3 short-name behavior" | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizePagefile") {
        $pagefileTarget = Get-ConfigItemTarget $Config "storageOptimization" "optimizePagefile"
        if ($pagefileTarget -eq "systemManaged") {
            Enable-TrackedAutomaticPagefile | Out-Null
        } elseif ($pagefileTarget -eq "disabled") {
            Disable-TrackedPagefile | Out-Null
        } else {
            $computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
            if ([bool]$computerSystem.AutomaticManagedPagefile) { throw "A custom pagefile target requires explicit sizes" }
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableHibernation") {
        $hibernationEnabled = [bool](Get-ConfigItemTarget $Config "storageOptimization" "disableHibernation")
        Set-TrackedHibernation -Enabled $hibernationEnabled -Description "Set hibernation target" | Out-Null
    }
}
