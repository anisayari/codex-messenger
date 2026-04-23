$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$url = "http://127.0.0.1:5174/"

Start-Process -FilePath $npm -ArgumentList @("run", "dev") -WorkingDirectory $repoRoot
Start-Sleep -Seconds 2
Start-Process $url
