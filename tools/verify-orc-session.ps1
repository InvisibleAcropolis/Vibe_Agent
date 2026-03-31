param(
	[string]$WorkspaceRoot = (Get-Location).Path,
	[switch]$SkipAttach
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$helperPath = Join-Path $repoRoot "tools\verify-orc-session.ts"

if (-not (Test-Path -LiteralPath $helperPath)) {
	throw "Missing helper script at $helperPath"
}

$configPath = Join-Path $HOME "Vibe_Agent\config\vibe-agent-config.json"
$authPath = Join-Path $HOME ".pi\agent\auth.json"

Write-Host "Verifying Orc session prerequisites..."
Write-Host "Workspace: $WorkspaceRoot"
Write-Host "Config:    $configPath"
Write-Host "Auth:      $authPath"

if (-not (Test-Path -LiteralPath $configPath)) {
	throw "Missing Vibe config file: $configPath"
}

if (-not (Test-Path -LiteralPath $authPath)) {
	throw "Missing auth file: $authPath"
}

$launchFlag = if ($SkipAttach) { @() } else { @("--launch") }
$args = @("--workspace-root=$WorkspaceRoot") + $launchFlag

& node --import tsx $helperPath @args
if ($LASTEXITCODE -ne 0) {
	throw "Orc verification failed."
}

if ($SkipAttach) {
	Write-Host "Validation completed without opening the external Orc session."
} else {
	Write-Host "Validation completed and the external Orc session launch was requested."
}
