#requires -Version 5.1
param([switch]$NoUi, [switch]$TestMode)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
if ($TestMode) { return }
try {
  # The Node helper owns strictPort, readiness, browser opening and cleanup.
  exit ([int](Invoke-SourceLauncher $repoRoot 'preview'))
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
