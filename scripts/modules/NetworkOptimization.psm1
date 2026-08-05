#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Get-PhysicalConnectedAdapters {
    return @(Get-NetAdapter -ErrorAction Stop | Where-Object {
        $_.Status -eq "Up" -and $_.HardwareInterface -and $_.InterfaceDescription -notmatch "Virtual|VPN|TAP"
    })
}

function Set-TrackedDnsServers {
    param(
        [Parameter(Mandatory = $true)]$Adapter,
        [Parameter(Mandatory = $true)][string[]]$ServerAddresses
    )

    $current = @(Get-DnsClientServerAddress -InterfaceIndex $Adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty ServerAddresses)
    if (($current -join ",") -eq ($ServerAddresses -join ",")) { return $false }

    $ifacePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$($Adapter.InterfaceGuid)}"
    $nameServer = Get-ItemProperty -LiteralPath $ifacePath -Name "NameServer" -ErrorAction SilentlyContinue
    $wasAutomatic = ($null -eq $nameServer -or [string]::IsNullOrWhiteSpace([string]$nameServer.NameServer))
    $metadata = @{ WasAutomatic = $wasAutomatic; InterfaceName = [string]$Adapter.Name }
    $changeId = Register-OptimizationChange -Kind "DnsServers" -Target ([string]$Adapter.InterfaceIndex) -OriginalValue $current -NewValue $ServerAddresses -Description "Set public DNS servers" -Metadata $metadata
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Set-DnsClientServerAddress -InterfaceIndex $Adapter.InterfaceIndex -ServerAddresses $ServerAddresses -ErrorAction Stop
    }
    return $true
}

function Reset-TrackedDnsServers {
    param([Parameter(Mandatory = $true)]$Adapter)

    $current = @(Get-DnsClientServerAddress -InterfaceIndex $Adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty ServerAddresses)
    $ifacePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$($Adapter.InterfaceGuid)}"
    $nameServer = Get-ItemProperty -LiteralPath $ifacePath -Name "NameServer" -ErrorAction SilentlyContinue
    $wasAutomatic = ($null -eq $nameServer -or [string]::IsNullOrWhiteSpace([string]$nameServer.NameServer))
    if ($wasAutomatic) { return $false }
    $changeId = Register-OptimizationChange -Kind "DnsServers" -Target ([string]$Adapter.InterfaceIndex) -OriginalValue $current -NewValue "automatic" -Description "Restore automatic DNS servers" -Metadata @{ WasAutomatic = $false; InterfaceName = [string]$Adapter.Name }
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Set-DnsClientServerAddress -InterfaceIndex $Adapter.InterfaceIndex -ResetServerAddresses -ErrorAction Stop
    }
    return $true
}

function Disable-TrackedAdapterPowerManagement {
    param([Parameter(Mandatory = $true)]$Adapter)

    $power = Get-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
    $propertyNames = @("ArpOffload", "D0PacketCoalescing", "DeviceSleepOnDisconnect", "NSOffload", "RsnRekeyOffload", "SelectiveSuspend", "WakeOnMagicPacket", "WakeOnPattern")
    $original = [ordered]@{}
    $hasEnabledSetting = $false
    foreach ($propertyName in $propertyNames) {
        $property = $power.PSObject.Properties[$propertyName]
        if ($null -ne $property) {
            $value = [string]$property.Value
            $original[$propertyName] = $value
            if ($value -eq "Enabled") { $hasEnabledSetting = $true }
        }
    }
    if (-not $hasEnabledSetting) { return $false }

    $changeId = Register-OptimizationChange -Kind "NicPowerManagement" -Target ([string]$Adapter.Name) -OriginalValue ([PSCustomObject]$original) -NewValue "Disabled" -Description "Disable adapter power-saving features"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Disable-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
    }
    return $true
}

function Enable-TrackedAdapterPowerManagement {
    param([Parameter(Mandatory = $true)]$Adapter)

    $power = Get-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
    $propertyNames = @("ArpOffload", "D0PacketCoalescing", "DeviceSleepOnDisconnect", "NSOffload", "RsnRekeyOffload", "SelectiveSuspend", "WakeOnMagicPacket", "WakeOnPattern")
    $original = [ordered]@{}
    $hasDisabledSetting = $false
    foreach ($propertyName in $propertyNames) {
        $property = $power.PSObject.Properties[$propertyName]
        if ($null -ne $property) {
            $value = [string]$property.Value
            $original[$propertyName] = $value
            if ($value -eq "Disabled") { $hasDisabledSetting = $true }
        }
    }
    if (-not $hasDisabledSetting) { return $false }
    $changeId = Register-OptimizationChange -Kind "NicPowerManagement" -Target ([string]$Adapter.Name) -OriginalValue ([PSCustomObject]$original) -NewValue "Enabled" -Description "Enable adapter power-saving features"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Enable-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
    }
    return $true
}

function Invoke-NetworkOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "Network Optimization"
    $adapters = @()
    if ((Test-OptimizationItemPlanned -Items $Items -ItemName "disableNagle") -or
        (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizeDns") -or
        (Test-OptimizationItemPlanned -Items $Items -ItemName "disableNicPowerSave")) {
        $adapters = Get-PhysicalConnectedAdapters
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableNagle") {
        $nagleEnabled = [bool](Get-ConfigItemTarget $Config "networkOptimization" "disableNagle")
        foreach ($adapter in $adapters) {
            $ifacePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$($adapter.InterfaceGuid)}"
            if (Test-Path -LiteralPath $ifacePath) {
                if ($nagleEnabled) {
                    Remove-RegistryValue -Path $ifacePath -Name "TcpAckFrequency" -Description "Restore TCP acknowledgement behavior" | Out-Null
                    Remove-RegistryValue -Path $ifacePath -Name "TCPNoDelay" -Description "Restore Nagle buffering" | Out-Null
                } else {
                    Set-RegistryValue -Path $ifacePath -Name "TcpAckFrequency" -Value 1 -Type DWord -Description "Disable delayed TCP acknowledgements" | Out-Null
                    Set-RegistryValue -Path $ifacePath -Name "TCPNoDelay" -Value 1 -Type DWord -Description "Disable Nagle buffering" | Out-Null
                }
            }
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableThrottling") {
        $throttlingEnabled = [bool](Get-ConfigItemTarget $Config "networkOptimization" "disableThrottling")
        $profilePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile"
        if ($throttlingEnabled) {
            Remove-RegistryValue -Path $profilePath -Name "NetworkThrottlingIndex" -Description "Restore network throttling" | Out-Null
        } else {
            Set-RegistryValue -Path $profilePath -Name "NetworkThrottlingIndex" -Value 4294967295 -Type DWord -Description "Disable multimedia network throttling" | Out-Null
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableBandwidthLimit") {
        $bandwidthTarget = Get-ConfigItemTarget $Config "networkOptimization" "disableBandwidthLimit"
        $bandwidthPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched"
        if ($bandwidthTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $bandwidthPath -Name "NonBestEffortLimit" -Description "Restore default bandwidth reservation" | Out-Null
        } else {
            Set-RegistryValue -Path $bandwidthPath -Name "NonBestEffortLimit" -Value ([int]$bandwidthTarget) -Type DWord -Description "Set policy bandwidth reservation" | Out-Null
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizeDns") {
        $dnsTarget = Get-ConfigItemTarget $Config "networkOptimization" "optimizeDns"
        if ($dnsTarget -eq "cloudflare") {
            foreach ($adapter in $adapters) {
                if (Set-TrackedDnsServers -Adapter $adapter -ServerAddresses @("1.1.1.1", "1.0.0.1")) {
                    Write-LogItem -ItemName "DNS" -Description "$($adapter.Name) -> Cloudflare" -Status "SUCCESS"
                }
            }
        } elseif ($dnsTarget -eq "automatic") {
            foreach ($adapter in $adapters) { Reset-TrackedDnsServers -Adapter $adapter | Out-Null }
        }
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableNicPowerSave") {
        $nicPowerTarget = Get-ConfigItemTarget $Config "networkOptimization" "disableNicPowerSave"
        if ($nicPowerTarget -eq "disabled") {
            foreach ($adapter in $adapters) {
                Disable-TrackedAdapterPowerManagement -Adapter $adapter | Out-Null
            }
        } elseif ($nicPowerTarget -eq "enabled") {
            foreach ($adapter in $adapters) { Enable-TrackedAdapterPowerManagement -Adapter $adapter | Out-Null }
        }
    }
}
