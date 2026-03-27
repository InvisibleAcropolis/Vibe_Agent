param(
	[string]$SessionName = "vibe_core",
	[string]$Label = "snapshot",
	[string]$OutFile
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command psmux -ErrorAction SilentlyContinue)) {
	throw "psmux is not available on PATH."
}

& psmux has-session -t $SessionName 2>$null
if ($LASTEXITCODE -ne 0) {
	throw "psmux session '$SessionName' does not exist."
}

$sessionSummary = (& psmux display-message -p -t $SessionName "session=#{session_name} window=#{window_width}x#{window_height} panes=#{window_panes}").Trim()
$paneLines = @(& psmux list-panes -t $SessionName -F "#{pane_id}|#{pane_active}|#{pane_left},#{pane_top}|#{pane_width}x#{pane_height}|#{pane_current_command}")
$clientLines = @(& psmux list-clients -F "#{client_name}|#{client_session}|#{client_width}x#{client_height}" 2>$null)

$snapshot = [PSCustomObject]@{
	label = $Label
	recordedAt = (Get-Date).ToString("o")
	session = $SessionName
	summary = $sessionSummary
	panes = $paneLines
	clients = $clientLines
}

$json = $snapshot | ConvertTo-Json -Depth 4
$json

if ($OutFile) {
	$directory = Split-Path -Parent $OutFile
	if ($directory) {
		New-Item -ItemType Directory -Path $directory -Force | Out-Null
	}
	Add-Content -LiteralPath $OutFile -Value $json
}
