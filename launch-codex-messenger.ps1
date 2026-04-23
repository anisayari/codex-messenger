$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

Start-Process -FilePath $npm -ArgumentList @("run", "electron:start") -WorkingDirectory $root -WindowStyle Hidden
