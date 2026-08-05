#Requires -Version 5.1

Import-Module (Join-Path $PSScriptRoot "ChangeTracking.psm1")

function Initialize-RegistryTracker {
    [CmdletBinding()]
    param([string]$JournalPath)

    if ($JournalPath) {
        Initialize-OptimizationChangeTracker -JournalPath $JournalPath | Out-Null
    } else {
        Clear-OptimizationTrackedChanges -Collection Registry
    }
}

function Get-RegistryValueState {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)

    $keyExists = Test-Path -LiteralPath $Path
    if (-not $keyExists) {
        return [PSCustomObject]@{ KeyExists = $false; ValueExists = $false; Value = $null; Type = $null }
    }

    $key = Get-Item -LiteralPath $Path -ErrorAction Stop
    $valueExists = @($key.GetValueNames()) -contains $Name
    if (-not $valueExists) {
        return [PSCustomObject]@{ KeyExists = $true; ValueExists = $false; Value = $null; Type = $null }
    }

    $value = $key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $type = $key.GetValueKind($Name).ToString()
    return [PSCustomObject]@{ KeyExists = $true; ValueExists = $true; Value = $value; Type = $type }
}

function Get-RegistryValue {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)
    try { return (Get-RegistryValueState -Path $Path -Name $Name).Value }
    catch { return $null }
}

function Test-AllowedRegistryRestoreTarget {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)

    if ($Name -notmatch '^[^\\/\x00-\x1f]{1,255}$') { return $false }

    $exactTargets = @{
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\DeliveryOptimization" = @("DODownloadMode")
        "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" = @("DeferQualityUpdatesInDays","DeferFeatureUpdatesInDays","PauseQualityUpdatesStartTime","PauseFeatureUpdatesStartTime")
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate" = @("ExcludeWUDriversInQualityUpdate")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" = @("ExcludeWUDriversInQualityUpdate","DeferQualityUpdates","DeferQualityUpdatesPeriodInDays","DeferFeatureUpdates","DeferFeatureUpdatesPeriodInDays")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" = @("NoAutoUpdate","AUOptions")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" = @("DODownloadMode")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched" = @("NonBestEffortLimit")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy" = @("LetAppsRunInBackground")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Applications" = @("AllowBackgroundApps")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" = @("AllowGameDVR")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" = @("AllowTelemetry","DiagnosticDataViewer")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" = @("EnableActivityFeed","PublishUserActivities")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors" = @("DisableLocation")
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search" = @("AllowCortana")
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" = @("HiberbootEnabled")
        "HKLM:\SYSTEM\CurrentControlSet\Control\Power" = @("PowerThrottlingOff")
        "HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl" = @("CrashDumpEnabled")
        "HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl" = @("Win32PrioritySeparation")
        "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" = @("HwSchMode")
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" = @("LargeSystemCache","FeatureSettingsOverride","FeatureSettingsOverrideMask")
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters" = @("EnablePrefetcher","EnableSuperfetch")
        "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" = @("NetworkThrottlingIndex")
        "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games" = @("GPU Priority","Priority")
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI\BootAnimation" = @("DisableStartupSound")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" = @("EnableTransparency")
        "HKCU:\Control Panel\Desktop\WindowMetrics" = @("MinAnimate")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" = @("ListviewShadow","SnapAssist","TaskbarDa")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects" = @("VisualFXSetting")
        "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" = @("TurnOffWindowsCopilot")
        "HKCU:\Software\Policies\Microsoft\Windows\Explorer" = @("DisableNotificationCenter")
        "HKCU:\Software\Microsoft\GameBar" = @("AllowAutoGameMode")
        "HKCU:\System\GameConfigStore" = @("GameDVR_HonorUserFSEBehaviorMode","GameDVR_FSEBehaviorMode","GameDVR_Enabled")
        "HKCU:\Software\Microsoft\Windows\Dwm" = @("EnableAeroPeek")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo" = @("Enabled")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" = @("SubscribedContent-338389Enabled","SystemPaneSuggestionsEnabled")
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications" = @("GlobalUserDisabled")
    }
    foreach ($targetPath in $exactTargets.Keys) {
        if ($Path.Equals($targetPath, [StringComparison]::OrdinalIgnoreCase)) {
            return @($exactTargets[$targetPath]) -contains $Name
        }
    }

    if ($Path -match '^HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$') {
        return @("TcpAckFrequency","TCPNoDelay") -contains $Name
    }
    if ($Path -match '^HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\\{4d36e968-e325-11ce-bfc1-08002be10318\}\\\d{4}$') {
        return @("PerfLevelSrc","PowerMizerEnable","PowerMizerLevel","PowerMizerLevelAC","EnableUlps","GpuWorkload") -contains $Name
    }
    return $false
}

function Set-RegistryValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][ValidateSet("DWord","QWord","String","ExpandString","MultiString","Binary")][string]$Type,
        [string]$Description = ""
    )

    $original = Get-RegistryValueState -Path $Path -Name $Name
    $metadata = [PSCustomObject]@{
        Path = $Path
        Name = $Name
        OriginalType = $original.Type
        NewType = $Type
        OriginalKeyExists = $original.KeyExists
    }
    $changeId = Add-RegistryChangeRecord -Path $Path -Name $Name -OriginalValue $original.Value -NewValue $Value -OriginalExists $original.ValueExists -Description $Description -Metadata $metadata

    try {
        if (-not $original.KeyExists) { New-Item -Path $Path -Force -ErrorAction Stop | Out-Null }
        New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force -ErrorAction Stop | Out-Null
        $written = Get-RegistryValueState -Path $Path -Name $Name
        if (-not $written.ValueExists -or $written.Type -ne $Type -or
            (ConvertTo-Json $written.Value -Compress) -ne (ConvertTo-Json $Value -Compress)) {
            throw "Registry value verification failed after write: $Path\$Name"
        }
    } catch {
        $actionError = $_.Exception.Message
        try { Set-OptimizationChangeResult -Id $changeId -Status Failed -ErrorMessage $actionError }
        catch { throw "Registry write failed and its journal status could not be saved: $Path\$Name - $actionError; journal: $($_.Exception.Message)" }
        throw "Registry write failed: $Path\$Name - $actionError"
    }
    try { Set-OptimizationChangeResult -Id $changeId -Status Applied }
    catch { throw "Registry write succeeded, but its journal status could not be saved; no further changes are safe: $Path\$Name - $($_.Exception.Message)" }
    return $true
}

function Remove-RegistryValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Description = ""
    )

    $original = Get-RegistryValueState -Path $Path -Name $Name
    if (-not $original.ValueExists) { return $true }

    $metadata = [PSCustomObject]@{
        Path = $Path
        Name = $Name
        OriginalType = $original.Type
        NewType = "Removed"
        OriginalKeyExists = $original.KeyExists
    }
    $changeId = Add-RegistryChangeRecord -Path $Path -Name $Name -OriginalValue $original.Value -NewValue $null -OriginalExists $true -Description $Description -Metadata $metadata
    try {
        Remove-ItemProperty -Path $Path -Name $Name -Force -ErrorAction Stop
        if ((Get-RegistryValueState -Path $Path -Name $Name).ValueExists) {
            throw "Registry value verification failed after delete: $Path\$Name"
        }
    } catch {
        $actionError = $_.Exception.Message
        try { Set-OptimizationChangeResult -Id $changeId -Status Failed -ErrorMessage $actionError }
        catch { throw "Registry delete failed and its journal status could not be saved: $Path\$Name - $actionError; journal: $($_.Exception.Message)" }
        throw "Registry delete failed: $Path\$Name - $actionError"
    }
    try { Set-OptimizationChangeResult -Id $changeId -Status Applied }
    catch { throw "Registry delete succeeded, but its journal status could not be saved; no further changes are safe: $Path\$Name - $($_.Exception.Message)" }
    return $true
}

function Export-Changes {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$OutputPath)
    return Save-OptimizationChangeJournal -OutputPath $OutputPath
}

function Get-Changes { return @(Get-TrackedRegistryChanges) }
function Get-ChangesCount { return @(Get-TrackedRegistryChanges).Count }

function Restore-RegistryChangeRecord {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Change)

    $path = [string]$Change.Metadata.Path
    $name = [string]$Change.Metadata.Name
    if (-not (Test-AllowedRegistryRestoreTarget -Path $path -Name $name)) {
        throw "Registry target is not allowlisted: $path\$name"
    }

    if ([bool]$Change.OriginalExists) {
        if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force -ErrorAction Stop | Out-Null }
        $type = [string]$Change.Metadata.OriginalType
        if (@("DWord","QWord","String","ExpandString","MultiString","Binary") -notcontains $type) {
            throw "Unsupported original registry type: $type"
        }
        New-ItemProperty -Path $path -Name $name -Value $Change.OriginalValue -PropertyType $type -Force -ErrorAction Stop | Out-Null
        $restoredState = Get-RegistryValueState -Path $path -Name $name
        if (-not $restoredState.ValueExists -or $restoredState.Type -ne $type -or
            (ConvertTo-Json $restoredState.Value -Compress) -ne (ConvertTo-Json $Change.OriginalValue -Compress)) {
            throw "Registry value verification failed after restore: $path\$name"
        }
    } else {
        if (Test-Path -LiteralPath $path) {
            $currentState = Get-RegistryValueState -Path $path -Name $name
            if ($currentState.ValueExists) {
                Remove-ItemProperty -Path $path -Name $name -Force -ErrorAction Stop
            }
            if (-not [bool]$Change.Metadata.OriginalKeyExists) {
                $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
                if ($key -and @($key.GetValueNames()).Count -eq 0 -and @($key.GetSubKeyNames()).Count -eq 0) {
                    Remove-Item -LiteralPath $path -Force -ErrorAction Stop
                }
            }
        }
        $restoredState = Get-RegistryValueState -Path $path -Name $name
        if ($restoredState.ValueExists) { throw "Registry value still exists after restore: $path\$name" }
    }
}

function Restore-RegistryChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ChangesJsonPath)

    return Invoke-TrackedRestoreRecords -ChangesJsonPath $ChangesJsonPath -Collection Registry -RestoreAction {
        param($change)
        Restore-RegistryChangeRecord -Change $change
    }
}

Export-ModuleMember -Function Initialize-RegistryTracker, Get-RegistryValue, Set-RegistryValue, Remove-RegistryValue, Export-Changes, Get-Changes, Get-ChangesCount, Restore-RegistryChangeRecord, Restore-RegistryChanges, Register-OptimizationChange, Set-OptimizationChangeResult
