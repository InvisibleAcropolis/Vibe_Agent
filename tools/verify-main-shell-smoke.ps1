param(
	[string]$SessionName = "vibe_main_shell_smoke",
	[string]$PromptText = "Print a one-line shell smoke confirmation.",
	[int]$StartupDelaySeconds = 8,
	[int]$ResponseDelaySeconds = 20,
	[switch]$SkipPrompt,
	[switch]$TriggerOrcSurface,
	[switch]$ResetSession,
	[string]$CaptureFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-PsmuxSession {
	param([string]$Name)
	& psmux has-session -t $Name 2>$null
	return $LASTEXITCODE -eq 0
}

function Quote-PowerShellLiteral {
	param([string]$Value)
	return "'" + $Value.Replace("'", "''") + "'"
}

function Get-RouteSignalPath {
	param([string]$Name)
	$sanitized = ($Name.Trim() -replace "[^A-Za-z0-9._-]+", "_")
	return Join-Path $HOME "Vibe_Agent\tracker\secondary-surface-route-$sanitized.json"
}

$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$layoutScript = Join-Path $repoRoot "tools\verify-psmux-layout.ps1"

if (-not (Get-Command psmux -ErrorAction SilentlyContinue)) {
	throw "psmux is not available on PATH."
}

if (-not (Test-Path -LiteralPath $layoutScript)) {
	throw "Missing layout verifier at $layoutScript"
}

if ($ResetSession -and (Test-PsmuxSession -Name $SessionName)) {
	& psmux kill-session -t $SessionName 2>$null
}

if (-not (Test-PsmuxSession -Name $SessionName)) {
	$repoLiteral = Quote-PowerShellLiteral -Value $repoRoot
	$launchCommand = @(
		"Set-Location -LiteralPath $repoLiteral",
		"`$env:VIBE_MAIN_SHELL='next'",
		"`$env:VIBE_TRANSCRIPT_PUBLICATION_MODE='dual'",
		"node .\bin\vibe-agent.js"
	) -join "; "

	& psmux new-session -d -s $SessionName -x 160 -y 48 -c $repoRoot -- `
		"pwsh.exe" "-NoLogo" "-NoProfile"

	if ($LASTEXITCODE -ne 0) {
		throw "Unable to create main-shell smoke session '$SessionName'."
	}

	Start-Sleep -Milliseconds 500
	& psmux send-keys -t $SessionName $launchCommand Enter
	if ($LASTEXITCODE -ne 0) {
		throw "Unable to launch Vibe Agent inside '$SessionName'."
	}
}

Start-Sleep -Seconds $StartupDelaySeconds

if (-not (Test-PsmuxSession -Name $SessionName)) {
	throw "Main-shell smoke session '$SessionName' exited before validation. Check provider/config startup requirements and rerun."
}

if (-not $SkipPrompt) {
	& psmux send-keys -t $SessionName $PromptText Enter
	if ($LASTEXITCODE -ne 0) {
		throw "Unable to submit prompt text to '$SessionName'."
	}
	Start-Sleep -Seconds $ResponseDelaySeconds
}

& psmux send-keys -t $SessionName PageUp
Start-Sleep -Milliseconds 600
& psmux send-keys -t $SessionName End
Start-Sleep -Milliseconds 600

if ($TriggerOrcSurface) {
	& psmux send-keys -t $SessionName F3
	Start-Sleep -Seconds 3
}

$paneCapture = @(& psmux capture-pane -p -t $SessionName)
$layoutJson = & pwsh -NoProfile -ExecutionPolicy Bypass -File $layoutScript -SessionName $SessionName -Label "main-shell-smoke"
$layout = $layoutJson | ConvertFrom-Json

$routeSignalPath = Get-RouteSignalPath -Name $SessionName
$routeSignal = $null
if (Test-Path -LiteralPath $routeSignalPath) {
	$routeSignal = Get-Content -LiteralPath $routeSignalPath -Raw | ConvertFrom-Json
}

$result = [PSCustomObject]@{
	session = $SessionName
	repoRoot = $repoRoot
	startupDelaySeconds = $StartupDelaySeconds
	responseDelaySeconds = if ($SkipPrompt) { 0 } else { $ResponseDelaySeconds }
	promptSubmitted = -not $SkipPrompt
	triggeredOrcSurface = [bool]$TriggerOrcSurface
	layout = $layout
	routeSignalPath = $routeSignalPath
	routeSignal = $routeSignal
	capturedPaneTail = @($paneCapture | Select-Object -Last 40)
}

$json = $result | ConvertTo-Json -Depth 8
$json

if ($CaptureFile) {
	$directory = Split-Path -Parent $CaptureFile
	if ($directory) {
		New-Item -ItemType Directory -Path $directory -Force | Out-Null
	}
	Set-Content -LiteralPath $CaptureFile -Value $json -Encoding utf8
}
