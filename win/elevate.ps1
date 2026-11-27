# Runs firewall.ps1 as administrator (one UAC prompt) and passes its exit code back. Start-Process joins its
# arguments into one command line without quoting, so the two paths must be plain: no spaces or shell characters.
param([Parameter(Mandatory)][string]$Script, [Parameter(Mandatory)][string]$Request)
$ErrorActionPreference = 'Stop'
foreach ($p in $Script, $Request) {
    if ($p -match '[\s"''`$;&|<>()]') { throw "path '$p' must not contain spaces or shell characters" }
}
$proc = Start-Process pwsh -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script, '-Request', $Request)
exit $proc.ExitCode
