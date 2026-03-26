Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "[bootstrap] $Message" -ForegroundColor Cyan
}

function Fail-Fast {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function Get-CommandPath {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($command.Source)) {
        return $command.Definition
    }

    return $command.Source
}

function Install-FromWinget {
    Write-Step 'Attempting install via WinGet (preferred): winget install psmux'
    & winget install psmux --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "WinGet returned exit code $LASTEXITCODE."
    }
}

function Install-FromCargo {
    Write-Step 'Attempting install via Cargo fallback: cargo install psmux'
    & cargo install psmux
    if ($LASTEXITCODE -ne 0) {
        throw "Cargo returned exit code $LASTEXITCODE."
    }
}

function Test-HostCapabilities {
    # psmux is a Windows-native multiplexer. Fail early on non-Windows hosts.
    $isWindowsHost = $IsWindows
    if (-not $isWindowsHost) {
        $isWindowsHost = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
            [System.Runtime.InteropServices.OSPlatform]::Windows
        )
    }

    if (-not $isWindowsHost) {
        Fail-Fast @"
This bootstrap script only supports Windows hosts because psmux uses native ConPTY APIs.
Run this script from Windows PowerShell / PowerShell 7 on Windows 10+.
"@
    }
}

function Ensure-PsmuxCommands {
    $expectedCommands = @('psmux', 'pmux', 'tmux')
    $resolved = @{}

    foreach ($name in $expectedCommands) {
        $path = Get-CommandPath -Name $name
        if (-not $path) {
            $cargoBin = Join-Path $env:USERPROFILE '.cargo\\bin'
            Fail-Fast @"
Unable to resolve '$name' on PATH after installation.
Expected psmux to provide psmux/pmux/tmux command names.
Action:
  1) Restart your shell so PATH changes are loaded.
  2) Confirm install location is on PATH (commonly '$cargoBin').
  3) Re-run one of:
     - winget install psmux
     - cargo install psmux
"@
        }

        $resolved[$name] = $path
    }

    Write-Step 'Verified command resolution:'
    foreach ($entry in $resolved.GetEnumerator() | Sort-Object Name) {
        Write-Host ("  {0} -> {1}" -f $entry.Key, $entry.Value) -ForegroundColor Green
    }
}

Test-HostCapabilities

$hasWinget = [bool](Get-Command -Name 'winget' -ErrorAction SilentlyContinue)
$hasCargo = [bool](Get-Command -Name 'cargo' -ErrorAction SilentlyContinue)

if ($hasWinget) {
    $wingetError = $null
    try {
        Install-FromWinget
    } catch {
        $wingetError = $_.Exception.Message
        Write-Warning "WinGet installation failed: $wingetError"

        if ($hasCargo) {
            Write-Step 'Falling back to cargo because Rust toolchain is available.'
            try {
                Install-FromCargo
            } catch {
                $cargoError = $_.Exception.Message
                Fail-Fast @"
Both installation methods failed.
- WinGet failure: $wingetError
- Cargo failure: $cargoError
Action:
  * Check your network and package sources.
  * Retry: winget install psmux
  * Or: cargo install psmux
"@
            }
        } else {
            Fail-Fast @"
WinGet is available but installation failed, and Cargo is not available for fallback.
Action:
  * Retry: winget install psmux
  * Or install Rust (https://rustup.rs/) and run: cargo install psmux
"@
        }
    }
} elseif ($hasCargo) {
    Write-Step 'WinGet not found. Using cargo fallback because Rust toolchain is available.'
    try {
        Install-FromCargo
    } catch {
        Fail-Fast @"
Cargo fallback failed: $($_.Exception.Message)
Action:
  * Ensure Rust toolchain is healthy: rustup show
  * Retry: cargo install psmux
"@
    }
} else {
    Fail-Fast @"
No supported installer detected.
This script requires either:
  * WinGet (preferred): winget install psmux
  * Rust toolchain fallback: cargo install psmux
Action:
  * Install WinGet via App Installer from Microsoft Store, then retry.
  * Or install Rust from https://rustup.rs/ and retry.
"@
}

Ensure-PsmuxCommands
Write-Step 'bootstrap.ps1 completed successfully.'
