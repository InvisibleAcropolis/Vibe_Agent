param(
	[Parameter(Mandatory = $true)]
	[string]$SessionName
)

$ErrorActionPreference = "Stop"

$psmux = Get-Command psmux -ErrorAction Stop
& $psmux.Source attach -t $SessionName
exit $LASTEXITCODE
