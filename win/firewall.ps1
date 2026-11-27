# Adds or removes one inbound firewall rule. GraftKit runs this elevated. The values come from a JSON request file,
# never from command text, and the outcome is written next to it (<request>.result) because this window is hidden.
param([Parameter(Mandatory)][string]$Request)
$ErrorActionPreference = 'Stop'
$result = "$Request.result"
try {
    $r = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
    if ($r.action -notin 'open', 'close') { throw "unknown action '$($r.action)'" }
    if ($r.name -notmatch '^[\w .-]{1,64}$') { throw "bad rule name '$($r.name)'" }
    Get-NetFirewallRule -DisplayName $r.name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if ($r.action -eq 'open') {
        $port = [int]$r.port
        if ($port -lt 1 -or $port -gt 65535) { throw "bad port $($r.port)" }
        if (-not (Test-Path -LiteralPath $r.program -PathType Leaf)) { throw "no program at $($r.program)" }
        New-NetFirewallRule -DisplayName $r.name -Direction Inbound -Protocol TCP -LocalPort $port -Program $r.program `
            -RemoteAddress LocalSubnet -Action Allow | Out-Null
    }
    Set-Content -LiteralPath $result -Value 'ok'
} catch {
    Set-Content -LiteralPath $result -Value "error: $($_.Exception.Message)"
    exit 1
}
