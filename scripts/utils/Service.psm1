#Requires -Version 5.1

Import-Module (Join-Path $PSScriptRoot "ChangeTracking.psm1")
Import-Module (Join-Path $PSScriptRoot "NativeCommand.psm1")

$Script:AllowedServices = @(
    "DiagTrack", "dmwappushservice", "Fax", "RemoteRegistry", "WerSvc", "SysMain", "WSearch",
    "XblAuthManager", "XblGameSave", "XboxNetApiSvc", "XboxGipSvc",
    "diagnosticshub.standardcollector.service", "Spooler", "bthserv"
)

function Initialize-ServiceTracker { Clear-OptimizationTrackedChanges -Collection Service }

function Get-SafeService {
    param([Parameter(Mandatory = $true)][string]$ServiceName)
    try { return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue }
    catch { return $null }
}

function Get-ServiceStartupMode {
    param([Parameter(Mandatory = $true)]$Service)

    $startupType = $Service.StartType.ToString()
    if ($startupType -ne "Automatic") { return $startupType }
    $serviceConfig = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$($Service.Name)" -Name "DelayedAutoStart" -ErrorAction SilentlyContinue
    if ([int]$serviceConfig.DelayedAutoStart -eq 1) { return "AutomaticDelayedStart" }
    return "Automatic"
}

function Set-ServiceStartupMode {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][ValidateSet("Automatic","AutomaticDelayedStart","Manual","Disabled")][string]$StartupType
    )

    if ($StartupType -eq "AutomaticDelayedStart") {
        $serviceConfig = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -ErrorAction Stop
        $loadOrderGroup = [string]$serviceConfig.Group
        if (-not [string]::IsNullOrWhiteSpace($loadOrderGroup)) {
            throw "Delayed automatic startup is not supported for $ServiceName because it belongs to load-order group $loadOrderGroup"
        }
    }

    $scStartType = @{
        Automatic = "auto"
        AutomaticDelayedStart = "delayed-auto"
        Manual = "demand"
        Disabled = "disabled"
    }[$StartupType]
    Invoke-CheckedNativeCommand -FilePath "sc.exe" -ArgumentList @("config", $ServiceName, "start=", $scStartType) | Out-Null
}

function Set-ServiceStartup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][ValidateSet("Automatic","AutomaticDelayedStart","Manual","Disabled")][string]$StartupType,
        [string]$Description = ""
    )

    $service = Get-SafeService -ServiceName $ServiceName
    if (-not $service) { return @{ Success = $false; Message = "Service not found: $ServiceName" } }
    $originalStartup = Get-ServiceStartupMode -Service $service
    if ($originalStartup -eq $StartupType) { return @{ Success = $true; Message = "Already $StartupType" } }

    $metadata = [PSCustomObject]@{
        DisplayName = $service.DisplayName
        OriginalState = $service.Status.ToString()
    }
    $changeId = Add-ServiceChangeRecord -ServiceName $ServiceName -OriginalValue $originalStartup -NewValue $StartupType -Description $Description -Metadata $metadata
    try {
        Set-ServiceStartupMode -ServiceName $ServiceName -StartupType $StartupType
        $updatedService = Get-Service -Name $ServiceName -ErrorAction Stop
        $updatedStartup = Get-ServiceStartupMode -Service $updatedService
        if ($updatedStartup -ne $StartupType) {
            throw "Service startup type verification failed: expected $StartupType, found $updatedStartup"
        }
    } catch {
        $actionError = $_.Exception.Message
        try { Set-OptimizationChangeResult -Id $changeId -Status Failed -ErrorMessage $actionError }
        catch { throw "Service change failed and its journal status could not be saved: $ServiceName - $actionError; journal: $($_.Exception.Message)" }
        Add-OptimizationSessionError -Source "Service:$ServiceName" -Message $actionError
        return @{ Success = $false; Message = "Failed: $ServiceName - $actionError" }
    }
    try { Set-OptimizationChangeResult -Id $changeId -Status Applied }
    catch { throw "Service change succeeded, but its journal status could not be saved; no further changes are safe: $ServiceName - $($_.Exception.Message)" }
    return @{ Success = $true; Message = "${ServiceName}: $originalStartup -> $StartupType" }
}

function Export-ServiceChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$OutputPath)

    $manifest = Get-OptimizationChangeManifest
    $manifest.Changes = @()
    $manifest.RegistryChanges = @()
    $manifest.RegistryChangeCount = 0
    $manifest.Operations = @()
    $manifest.OperationCount = 0
    $manifest.ChangeCount = @($manifest.ServiceChanges).Count
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputPath))
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -Path $directory -ItemType Directory -Force -ErrorAction Stop | Out-Null }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($manifest | ConvertTo-Json -Depth 8), $encoding)
    return [IO.Path]::GetFullPath($OutputPath)
}

function Restore-ServiceChangeRecord {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Change)

    $serviceName = [string]$Change.Target
    if ($Script:AllowedServices -notcontains $serviceName) { throw "Service is not allowlisted: $serviceName" }
    $startupType = [string]$Change.OriginalValue
    if (@("Automatic","AutomaticDelayedStart","Manual","Disabled") -notcontains $startupType) {
        throw "Unsupported startup type: $startupType"
    }
    $originalState = [string]$Change.Metadata.OriginalState
    if (@("Running", "Stopped") -notcontains $originalState) {
        throw "Unsupported original service state: $originalState"
    }
    Set-ServiceStartupMode -ServiceName $serviceName -StartupType $startupType
    if ($originalState -eq "Running") {
        Start-Service -Name $serviceName -ErrorAction Stop
    } else {
        $service = Get-Service -Name $serviceName -ErrorAction Stop
        if ($service.Status -ne "Stopped") {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
        }
    }

    $restoredService = Get-Service -Name $serviceName -ErrorAction Stop
    $restoredStartupType = Get-ServiceStartupMode -Service $restoredService
    if ($restoredStartupType -ne $startupType) {
        throw "Service startup type verification failed: expected $startupType, found $restoredStartupType"
    }
    if ([string]$restoredService.Status -ne $originalState) {
        throw "Service state verification failed: expected $originalState, found $($restoredService.Status)"
    }
}

function Restore-ServiceChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ChangesJsonPath)

    return Invoke-TrackedRestoreRecords -ChangesJsonPath $ChangesJsonPath -Collection Service -RestoreAction {
        param($change)
        Restore-ServiceChangeRecord -Change $change
    }
}

function Get-ServiceChanges { return @(Get-TrackedServiceChanges) }

Export-ModuleMember -Function Initialize-ServiceTracker, Get-SafeService, Set-ServiceStartup, Export-ServiceChanges, Restore-ServiceChangeRecord, Restore-ServiceChanges, Get-ServiceChanges
