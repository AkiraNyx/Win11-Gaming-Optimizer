#Requires -Version 5.1

function Get-HardwareInfo {
    [CmdletBinding()]
    param()
    $info = [PSCustomObject]@{
        HasSSD = $false; HasHDD = $false; RAMGB = 0; CPUCores = 0
        CPUName = "Unknown"; GPUName = "Unknown"; GPUBrand = "Unknown"; Disks = @()
    }
    try {
        $disks = Get-PhysicalDisk -ErrorAction Stop | Select-Object DeviceId, FriendlyName, MediaType, Size
        foreach ($disk in $disks) {
            $info.Disks += [PSCustomObject]@{ Id = $disk.DeviceId; Name = $disk.FriendlyName; Type = $disk.MediaType; SizeGB = [math]::Round($disk.Size / 1GB, 1) }
            if ($disk.MediaType -eq "SSD") { $info.HasSSD = $true }
            elseif ($disk.MediaType -eq "HDD") { $info.HasHDD = $true }
        }
    } catch {}
    try { $info.RAMGB = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 0) } catch {}
    try { $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1; $info.CPUCores = $cpu.NumberOfCores; $info.CPUName = $cpu.Name.Trim() } catch {}
    try {
        $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name -notmatch "Microsoft|Basic|Remote" })
        if ($gpus) {
            $info.GPUName = (@($gpus | ForEach-Object { $_.Name.Trim() } | Select-Object -Unique) -join " + ")
            if (@($gpus | Where-Object { $_.Name -match "NVIDIA|GeForce|RTX|GTX" }).Count -gt 0) { $info.GPUBrand = "NVIDIA" }
            elseif (@($gpus | Where-Object { $_.Name -match "AMD|Radeon|RX" }).Count -gt 0) { $info.GPUBrand = "AMD" }
            elseif (@($gpus | Where-Object { $_.Name -match "Intel|Arc|UHD|Iris" }).Count -gt 0) { $info.GPUBrand = "Intel" }
        }
    } catch {}
    return $info
}

function Format-HardwareSummary {
    param([PSCustomObject]$HardwareInfo)
    $s = @()
    $s += "CPU: $($HardwareInfo.CPUName) ($($HardwareInfo.CPUCores) cores)"
    $s += "RAM: $($HardwareInfo.RAMGB) GB"
    $s += "GPU: $($HardwareInfo.GPUName) ($($HardwareInfo.GPUBrand))"
    $s += "Storage: SSD=$($HardwareInfo.HasSSD) HDD=$($HardwareInfo.HasHDD)"
    return $s -join "`n"
}

Export-ModuleMember -Function Get-HardwareInfo, Format-HardwareSummary
