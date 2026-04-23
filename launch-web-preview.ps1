$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$url = "http://127.0.0.1:5174/"

Start-Process -FilePath $npm -ArgumentList @("run", "dev") -WorkingDirectory $root
Start-Sleep -Seconds 2
Start-Process $url
