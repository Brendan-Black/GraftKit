# Runs the Graft server in this console as the current user. The server's port is open in the firewall (local
# networks only) while it runs, and closed again when it stops. GraftKit starts this in a window of its own.
param(
    [Parameter(Mandatory)][string]$ServerDir,
    [ValidatePattern('^\d{1,3}[MG]$')][string]$Ram = '6G',
    [Parameter(Mandatory)][string]$Elevate,
    [Parameter(Mandatory)][string]$Firewall
)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Graft server'
if (-not (Test-Path -LiteralPath (Join-Path $ServerDir 'graft.jar'))) { throw "no graft.jar in $ServerDir" }
$java = (Get-Command java).Source
$props = Get-Content -LiteralPath (Join-Path $ServerDir 'server.properties')
$portLine = $props | Where-Object { $_ -match '^server-port=(\d+)$' } | Select-Object -First 1
$port = if ($portLine) { [int]($portLine -replace '^server-port=', '') } else { 25565 }
$rule = "Minecraft Server $port"
$request = Join-Path $ServerDir 'graftkit\win\fw-server.json'

function Set-Rule([string]$action) {
    @{ action = $action; name = $rule; port = $port; program = $java } | ConvertTo-Json | Set-Content -LiteralPath $request
    Remove-Item -LiteralPath "$request.result" -ErrorAction SilentlyContinue
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $Elevate -Script $Firewall -Request $request
    $outcome = if (Test-Path -LiteralPath "$request.result") { (Get-Content -LiteralPath "$request.result" -Raw).Trim() } else { 'no answer (was the admin prompt declined?)' }
    if ($outcome -ne 'ok') { throw "firewall ($action): $outcome" }
}

Set-Rule open
Write-Host "Firewall: TCP $port open to local networks while the server runs" -ForegroundColor Green
try {
    Set-Location -LiteralPath $ServerDir
    & $java "-Xms$Ram" "-Xmx$Ram" -jar graft.jar server --nogui
} finally {
    try {
        Set-Rule close
        Write-Host "Firewall: TCP $port closed" -ForegroundColor Yellow
    } catch {
        Write-Host "The firewall rule '$rule' is still there: $($_.Exception.Message)" -ForegroundColor Red
    }
    Read-Host 'Server stopped. Press Enter to close'
}
