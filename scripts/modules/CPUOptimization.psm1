#Requires -Version 5.1
$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Invoke-CPUOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )
    Write-LogSection "CPU Optimization"
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizeTimer") {
        $timerTarget = Get-ConfigItemTarget $Config "cpuOptimization" "optimizeTimer"
        if ($timerTarget -eq "platformTick") {
            Set-TrackedBcdElement -Identifier "{current}" -Element "useplatformtick" -Value "Yes" -Description "Use the platform tick" | Out-Null
            Set-TrackedBcdElement -Identifier "{current}" -Element "disabledynamictick" -Value "Yes" -Description "Disable the dynamic tick" | Out-Null
        } else {
            Remove-TrackedBcdElement -Identifier "{current}" -Element "useplatformtick" -Description "Restore default platform tick" | Out-Null
            Remove-TrackedBcdElement -Identifier "{current}" -Element "disabledynamictick" -Description "Restore default dynamic tick" | Out-Null
        }
    }
    if ((Test-OptimizationItemPlanned -Items $Items -ItemName "disableHPET") -and
        (Test-ConfigItemCommand $Config "cpuOptimization" "disableHPET")) {
        Remove-TrackedBcdElement -Identifier "{current}" -Element "useplatformclock" -Description "Remove forced HPET platform clock" | Out-Null
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "disableCoreParking") {
        $coreParkingTarget = Get-ConfigItemTarget $Config "cpuOptimization" "disableCoreParking"
        if ($coreParkingTarget -eq "systemDefault") { throw "An explicit minimum-unparked-core percentage is required" }
        $subProcessor = "54533251-82be-4824-96c1-47b60b740d00"
        $minimumUnparkedCores = "0cc5b647-c1df-4637-891a-dec35c318583"
        Set-TrackedPowerSetting -Subgroup $subProcessor -Setting $minimumUnparkedCores -Value ([uint32]$coreParkingTarget) -Description "Set minimum unparked cores on AC power" | Out-Null
    }
}
