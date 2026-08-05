#Requires -Version 5.1

$Script:UtilsPath = Join-Path $PSScriptRoot "..\utils"
Import-Module (Join-Path $Script:UtilsPath "Registry.psm1") -Force

function Add-TrackedDefenderExclusionPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ExistingPaths
    )

    $alreadyExists = @($ExistingPaths | Where-Object { $_ -and $_.TrimEnd("\") -ieq $Path.TrimEnd("\") }).Count -gt 0
    if ($alreadyExists) { return $false }

    $changeId = Register-OptimizationChange -Kind "DefenderExclusionPath" -Target $Path -OriginalValue $null -NewValue $Path -OriginalExists $false -Description "Add an explicitly requested game-library exclusion"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Add-MpPreference -ExclusionPath $Path -ErrorAction Stop
    }
    return $true
}

function Set-TrackedIdleDefenderScans {
    param([Parameter(Mandatory = $true)][bool]$Enabled)
    $preference = Get-MpPreference -ErrorAction Stop
    $original = [bool]$preference.ScanOnlyIfIdleEnabled
    if ($original -eq $Enabled) { return $false }

    $changeId = Register-OptimizationChange -Kind "DefenderPreference" -Target "ScanOnlyIfIdleEnabled" -OriginalValue $original -NewValue $Enabled -Description "Set scheduled Defender scan idle policy"
    Complete-TrackedOperation -ChangeId $changeId -Action {
        Set-MpPreference -ScanOnlyIfIdleEnabled $Enabled -ErrorAction Stop
    }
    return $true
}

function Invoke-SecurityOptimization {
    param(
        [PSCustomObject]$Config,
        [string[]]$Items
    )

    Write-LogSection "Security Optimization"
    if ((Test-OptimizationItemPlanned -Items $Items -ItemName "defenderExclusions") -and
        (Test-ConfigItemCommand $Config "securityOptimization" "defenderExclusions")) {
        $preference = Get-MpPreference -ErrorAction Stop
        $existingPaths = @($preference.ExclusionPath)
        $candidatePaths = @(
            "$env:ProgramFiles\Steam",
            "${env:ProgramFiles(x86)}\Steam",
            "$env:ProgramFiles\Epic Games",
            "$env:ProgramFiles\EA Games",
            "$env:ProgramFiles\Ubisoft",
            "$env:ProgramFiles\GOG Galaxy",
            "$env:SystemDrive\XboxGames",
            "$env:SystemDrive\Games"
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique

        if (@($candidatePaths).Count -eq 0) {
            Write-LogItem -ItemName "Defender exclusions" -Description "No known game-library directory was found" -Status "SKIP"
        } else {
            foreach ($path in $candidatePaths) {
                if (Add-TrackedDefenderExclusionPath -Path $path -ExistingPaths $existingPaths) {
                    Write-LogItem -ItemName "Defender exclusion" -Description $path -Status "SUCCESS"
                    $existingPaths += $path
                }
            }
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizeScanSchedule") {
        $idleScans = [bool](Get-ConfigItemTarget $Config "securityOptimization" "optimizeScanSchedule")
        Set-TrackedIdleDefenderScans -Enabled $idleScans | Out-Null
    }

    if (Test-OptimizationItemPlanned -Items $Items -ItemName "optimizeDEP") {
        $depTarget = Get-ConfigItemTarget $Config "securityOptimization" "optimizeDEP"
        if ($depTarget -eq "systemDefault") {
            Remove-TrackedBcdElement -Identifier "{current}" -Element "nx" -Description "Restore default DEP policy" | Out-Null
        } else {
            Set-TrackedBcdElement -Identifier "{current}" -Element "nx" -Value ([string]$depTarget) -Description "Set DEP policy" | Out-Null
        }
    }
    if (Test-OptimizationItemPlanned -Items $Items -ItemName "reduceMitigations") {
        $mitigationTarget = Get-ConfigItemTarget $Config "securityOptimization" "reduceMitigations"
        $memoryPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management"
        if ($mitigationTarget -eq "systemDefault") {
            Remove-RegistryValue -Path $memoryPath -Name "FeatureSettingsOverride" -Description "Restore default CPU mitigations" | Out-Null
            Remove-RegistryValue -Path $memoryPath -Name "FeatureSettingsOverrideMask" -Description "Restore default CPU mitigation mask" | Out-Null
        } else {
            Set-RegistryValue -Path $memoryPath -Name "FeatureSettingsOverride" -Value 3 -Type DWord -Description "Reduce CPU mitigations" | Out-Null
            Set-RegistryValue -Path $memoryPath -Name "FeatureSettingsOverrideMask" -Value 3 -Type DWord -Description "Mitigation mask" | Out-Null
        }
    }
}
