$launcher = Join-Path $PSScriptRoot "launchers\windows\launch-codex-messenger.ps1"
& $launcher @args
exit $LASTEXITCODE
