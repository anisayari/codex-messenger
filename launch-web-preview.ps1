$launcher = Join-Path $PSScriptRoot "launchers\windows\launch-web-preview.ps1"
& $launcher @args
exit $LASTEXITCODE
