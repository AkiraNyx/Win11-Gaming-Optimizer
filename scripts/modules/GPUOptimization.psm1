#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Get-DisplayAdapterRegistryEntries {
    $classPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
    return @(Get-ChildItem -LiteralPath $classPath -ErrorAction Stop | Where-Object { $_.PSChildName -match "^\d{4}$" } | ForEach-Object {
        $description = (Get-ItemProperty -LiteralPath $_.PSPath -Name "DriverDesc" -ErrorAction SilentlyContinue).DriverDesc
        if ($description) { [PSCustomObject]@{ Path = (Join-Path $classPath $_.PSChildName); Description = [string]$description } }
    })
}

function Invoke-GPUOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "GPU Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "hwSchedule") {
        $hwScheduleTarget = Get-ConfigItemTarget $Config "gpuOptimization" "hwSchedule"
        $graphicsPath = "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers"
        if ($hwScheduleTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $graphicsPath -Name "HwSchMode" -Description "Restore default GPU scheduling" | Out-Null
        } else {
            $hwScheduleValue = if ($hwScheduleTarget -eq "enabled") { 2 } else { 1 }
            Set-RegistryValue -Path $graphicsPath -Name "HwSchMode" -Value $hwScheduleValue -Type DWord -Description "Set hardware GPU scheduling" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableFullscreenOpt") {
        $fullscreenOptimizationsEnabled = [bool](Get-ConfigItemTarget $Config "gpuOptimization" "disableFullscreenOpt")
        $gameConfigPath = "HKCU:\System\GameConfigStore"
        if ($fullscreenOptimizationsEnabled) {
            Remove-RegistryValue -Path $gameConfigPath -Name "GameDVR_HonorUserFSEBehaviorMode" -Description "Restore fullscreen optimization behavior" | Out-Null
            Remove-RegistryValue -Path $gameConfigPath -Name "GameDVR_FSEBehaviorMode" -Description "Restore fullscreen enhancement behavior" | Out-Null
        } else {
            Set-RegistryValue -Path $gameConfigPath -Name "GameDVR_HonorUserFSEBehaviorMode" -Value 1 -Type DWord -Description "Honor application fullscreen behavior" | Out-Null
            Set-RegistryValue -Path $gameConfigPath -Name "GameDVR_FSEBehaviorMode" -Value 2 -Type DWord -Description "Disable fullscreen optimizations" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "gpuPriority") {
        $priorityTarget = Get-ConfigItemTarget $Config "gpuOptimization" "gpuPriority"
        $gamesPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games"
        if ($priorityTarget -eq "custom") {
            throw "A custom GPU priority target can only preserve the matching current state"
        } elseif ($priorityTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $gamesPath -Name "GPU Priority" -Description "Restore default game GPU priority" | Out-Null
            Remove-RegistryValue -Path $gamesPath -Name "Priority" -Description "Restore default game task priority" | Out-Null
        } else {
            Set-RegistryValue -Path $gamesPath -Name "GPU Priority" -Value ([int]$priorityTarget) -Type DWord -Description "Set game GPU priority" | Out-Null
            Set-RegistryValue -Path $gamesPath -Name "Priority" -Value 6 -Type DWord -Description "Set game task priority" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "aeroPeek") {
        $aeroPeekEnabled = [int][bool](Get-ConfigItemTarget $Config "gpuOptimization" "aeroPeek")
        Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\Dwm" -Name "EnableAeroPeek" -Value $aeroPeekEnabled -Type DWord -Description "Set Aero Peek target" | Out-Null
    }

    $applyNvidia = (Test-OptimizationItemPlanned -Items $Items -ItemName "nvidiaOptimize") -and (Test-ConfigItemCommand $Config "gpuOptimization" "nvidiaOptimize")
    $applyAmd = (Test-OptimizationItemPlanned -Items $Items -ItemName "amdOptimize") -and (Test-ConfigItemCommand $Config "gpuOptimization" "amdOptimize")
    if ($applyNvidia -or $applyAmd) {
        $entries = Get-DisplayAdapterRegistryEntries
        $matchedNvidia = 0
        $matchedAmd = 0
        foreach ($entry in $entries) {
            if ($applyNvidia -and $entry.Description -match "NVIDIA|GeForce") {
                Set-RegistryValue -Path $entry.Path -Name "PerfLevelSrc" -Value 8738 -Type DWord -Description "NVIDIA performance level source" | Out-Null
                Set-RegistryValue -Path $entry.Path -Name "PowerMizerEnable" -Value 1 -Type DWord -Description "Enable NVIDIA PowerMizer policy" | Out-Null
                Set-RegistryValue -Path $entry.Path -Name "PowerMizerLevel" -Value 1 -Type DWord -Description "NVIDIA maximum performance level" | Out-Null
                Set-RegistryValue -Path $entry.Path -Name "PowerMizerLevelAC" -Value 1 -Type DWord -Description "NVIDIA maximum AC performance level" | Out-Null
                Set-RegistryValue -Path $entry.Path -Name "EnableUlps" -Value 0 -Type DWord -Description "Disable NVIDIA ultra-low-power state" | Out-Null
                $matchedNvidia++
            }
            if ($applyAmd -and $entry.Description -match "AMD|Radeon") {
                Set-RegistryValue -Path $entry.Path -Name "GpuWorkload" -Value 2 -Type DWord -Description "Use AMD graphics workload mode" | Out-Null
                Set-RegistryValue -Path $entry.Path -Name "EnableUlps" -Value 0 -Type DWord -Description "Disable AMD ultra-low-power state" | Out-Null
                $matchedAmd++
            }
        }
        if ($applyNvidia) {
            $status = if ($matchedNvidia -gt 0) { "SUCCESS" } else { "SKIP" }
            Write-LogItem -ItemName "NVIDIA optimization" -Description "$matchedNvidia matching adapter(s)" -Status $status
        }
        if ($applyAmd) {
            $status = if ($matchedAmd -gt 0) { "SUCCESS" } else { "SKIP" }
            Write-LogItem -ItemName "AMD optimization" -Description "$matchedAmd matching adapter(s)" -Status $status
        }
    }
}
