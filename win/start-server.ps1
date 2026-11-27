# Opens run-server.ps1 in a console window of its own, which outlives GraftKit, then exits. Node can't do this
# itself: a "detached" child on Windows gets no console at all, and pwsh quits at once without one, while an attached
# child is killed when GraftKit exits. Start-Process joins its arguments into one command line without quoting, so
# every value must be plain: no spaces or shell characters.
param(
    [Parameter(Mandatory)][string]$RunServer,
    [Parameter(Mandatory)][string]$ServerDir,
    [ValidatePattern('^\d{1,3}[MG]$')][string]$Ram = '6G',
    [Parameter(Mandatory)][string]$Elevate,
    [Parameter(Mandatory)][string]$Firewall
)
$ErrorActionPreference = 'Stop'
foreach ($p in $RunServer, $ServerDir, $Elevate, $Firewall) {
    if ($p -match '[\s"''`$;&|<>()]') { throw "path '$p' must not contain spaces or shell characters" }
}
Start-Process pwsh -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $RunServer,
    '-ServerDir', $ServerDir, '-Ram', $Ram, '-Elevate', $Elevate, '-Firewall', $Firewall)
