#requires -Version 5.1
param([switch]$NoUi)

$ErrorActionPreference = 'Stop'
try {
  $launcher = Join-Path $PSScriptRoot 'launchers\windows\launch-web-preview.ps1'
  if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Launcher not found: $launcher" }
  & $launcher @PSBoundParameters @args
  # The platform script exits explicitly, including successful installed launches.
  exit ([int]$LASTEXITCODE)
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
