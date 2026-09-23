#requires -Version 5.1
param([switch]$AllowNonWindowsFixtures)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -and !$AllowNonWindowsFixtures) { throw 'These fixtures require Windows; the optional switch only runs portable mocks on another OS.' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
. (Join-Path $repo 'launchers\windows\launcher-common.ps1')
$original = @{}
foreach ($name in @('Get-MessengerRegistryEntries', 'Get-CodexMessengerInstall', 'Invoke-SourceLauncher', 'Invoke-LauncherNative', 'Test-LauncherDependencies')) { $original[$name] = (Get-Command $name).ScriptBlock }
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-messenger-windows-fixtures-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixtureRoot)
if ($env:OS -ne 'Windows_NT') {
  # macOS /var is itself a symlink. Portable safety correctly rejects it; use
  # the real temporary path for these optional OS-neutral mocked fixtures.
  $fixtureNode = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $fixtureRoot = (& $fixtureNode -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' $fixtureRoot | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or !$fixtureRoot) { throw 'Cannot resolve the fixture temporary path.' }
}
$script:Passed = 0; $script:Failed = 0

function Assert-Equal { param($Actual, $Expected, [string]$Message = '')
  if ($Actual -ne $Expected) { throw "$Message Expected <$Expected>, got <$Actual>." }
}
function Assert-True { param($Actual, [string]$Message = '')
  if (!$Actual) { throw "Expected true: $Message" }
}
function Assert-False { param($Actual, [string]$Message = '')
  if ($Actual) { throw "Expected false: $Message" }
}
function Assert-Throws { param([scriptblock]$Body, [string]$Pattern = '.')
  $caught = $null
  try { & $Body | Out-Null } catch { $caught = $_.Exception.Message }
  if (!$caught -or $caught -notmatch $Pattern) { throw "Expected error /$Pattern/, got <$caught>." }
}
function Test-Case { param([string]$Name, [scriptblock]$Body)
  try { & $Body; $script:Passed++; Write-Host "PASS $Name" } catch { $script:Failed++; Write-Host "FAIL $Name : $($_.Exception.Message)" }
}
function New-FixtureDirectory { param([string]$Name)
  $directory = Join-Path $fixtureRoot $Name
  [void][IO.Directory]::CreateDirectory($directory)
  return $directory
}
function Write-FixtureFile { param([string]$Path, [string]$Text = '')
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function New-FixtureApp { param([string]$Name)
  $directory = New-FixtureDirectory $Name
  Write-FixtureFile (Join-Path $directory 'Codex Messenger.exe')
  Write-FixtureFile (Join-Path $directory 'resources\app.asar') 'fixture, never executed'
  return $directory
}
function New-RegistryEntry { param([string]$Directory, [string]$Version = '0.0.4')
  [pscustomobject]@{ DisplayName = "Codex Messenger $Version"; DisplayVersion = $Version; InstallLocation = $Directory;
    PSChildName = '{aec7928a-9490-5305-a9b2-1a0182dfd515}'; PSPath = 'Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\{aec7928a-9490-5305-a9b2-1a0182dfd515}';
    UninstallString = '"' + (Join-Path $Directory 'Uninstall Codex Messenger.exe') + '"'; QuietUninstallString = '' }
}
function New-FixtureRegisteredUninstall { param([string]$Name)
  $script:UninstallApp = New-FixtureApp $Name
  $script:UninstallOriginal = Join-Path $script:UninstallApp 'Uninstall Codex Messenger.exe'
  Write-FixtureFile $script:UninstallOriginal 'verified uninstaller fixture, never executed'
  $script:UninstallEntry = New-RegistryEntry $script:UninstallApp
  $script:UninstallEntry.QuietUninstallString = '"' + $script:UninstallOriginal + '" /currentuser /S'
  return [pscustomobject]@{ Kind = 'registered'; Exe = (Join-Path $script:UninstallApp 'Codex Messenger.exe');
    InstallDir = $script:UninstallApp; RegistryPath = $script:UninstallEntry.PSPath;
    UninstallString = $script:UninstallEntry.UninstallString; QuietUninstallString = $script:UninstallEntry.QuietUninstallString }
}
function Start-Process { [CmdletBinding()]param([string]$FilePath, [string]$WorkingDirectory, $ArgumentList, [switch]$Wait, [switch]$PassThru)
  throw "Unexpected process execution: $FilePath"
}
function Remove-Item { [CmdletBinding()]param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
  throw "Unexpected removal: $LiteralPath"
}
function Invoke-RestMethod { [CmdletBinding()]param([string]$Uri, $Headers, [int]$TimeoutSec)
  throw "Unexpected network request: $Uri"
}

try {
  Test-Case 'all production scripts parse on the actual PowerShell runtime' {
    foreach ($relative in @('launch-codex-messenger.ps1', 'launch-web-preview.ps1', 'launchers\windows\launch-codex-messenger.ps1', 'launchers\windows\launch-web-preview.ps1', 'launchers\windows\launcher-common.ps1')) {
      $tokens = $null; $errors = $null
      [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $relative), [ref]$tokens, [ref]$errors)
      Assert-Equal @($errors).Count 0 $relative
    }
  }
  Test-Case 'actual registry collector accepts versioned NSIS DisplayName only with the real GUID' {
    $app = New-FixtureApp 'collector custom app'
    $good = New-RegistryEntry $app '0.0.4'
    $bad = New-RegistryEntry $app; $bad.PSChildName = '{00000000-0000-0000-0000-000000000000}'
    $bad.PSPath = 'Registry::wrong-key'
    $script:RegistryFixture = @($good, $bad)
    function Test-Path { [CmdletBinding()]param([string]$LiteralPath, [string]$PathType)
      if ($LiteralPath -like 'HKCU:*') { return $LiteralPath -notlike '*WOW6432Node*' }
      if ($LiteralPath -like 'HKLM:*') { return $false }
      return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
    }
    function Get-ChildItem { [CmdletBinding()]param([string]$LiteralPath, [switch]$Force)
      if ($LiteralPath -like 'HKCU:*') { return $script:RegistryFixture }
      return Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath -Force:$Force
    }
    function Get-ItemProperty { [CmdletBinding()]param([string]$LiteralPath)
      return $script:RegistryFixture | Where-Object { $_.PSPath -eq $LiteralPath }
    }
    $entries = @(& $original['Get-MessengerRegistryEntries'])
    Assert-Equal $entries.Count 1
    Assert-Equal $entries[0].DisplayName 'Codex Messenger 0.0.4'
    Assert-Equal $entries[0].InstallLocation $app
  }
  Test-Case 'similar product names and mismatched registry identity are rejected' {
    $entry = New-RegistryEntry $fixtureRoot
    foreach ($name in @('Codex Messenger Tools', 'Codex Messenger 0.0.4 extra', 'Different App')) {
      $entry.DisplayName = $name; Assert-False (Test-MessengerRegistryIdentity $entry)
    }
    $entry.DisplayName = 'Codex Messenger 0.0.4'; $entry.PSChildName = 'unrelated'; Assert-False (Test-MessengerRegistryIdentity $entry)
  }
  Test-Case 'custom installation keeps registry uninstaller and actual executable version in one tuple' {
    $app = New-FixtureApp 'custom installation'; $other = New-FixtureApp 'standard old installation'
    $script:Entry = New-RegistryEntry $app '0.0.3'
    function Get-MessengerRegistryEntries { $script:Entry }
    function Get-MessengerInstallCandidates { param($RepoRoot) $other }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger'; ProductVersion = '0.0.4' } }
    $install = & $original['Get-CodexMessengerInstall'] $repo
    Assert-Equal $install.Kind 'registered'; Assert-Equal $install.Version '0.0.4'
    Assert-Equal $install.Exe (Join-Path $app 'Codex Messenger.exe')
    Assert-Equal $install.InstallDir $app; Assert-Equal $install.UninstallString $script:Entry.UninstallString
  }
  Test-Case 'stale registry never attaches its version or uninstaller to another executable' {
    $app = New-FixtureApp 'fallback installation'; $script:Entry = New-RegistryEntry (Join-Path $fixtureRoot 'absent') '9.9.9'
    function Get-MessengerRegistryEntries { $script:Entry }
    function Get-MessengerInstallCandidates { param($RepoRoot) $app }
    function Test-PortableMessengerInstall { param($InstallDir) $false }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductVersion = '0.0.2' } }
    $install = & $original['Get-CodexMessengerInstall'] $repo
    Assert-Equal $install.Kind 'unregistered'; Assert-Equal $install.Version '0.0.2'
    Assert-Equal $install.UninstallString ''; Assert-Equal $install.RegistryPath ''
  }
  Test-Case 'legacy missing InstallLocation derives the matching uninstaller parent' {
    $app = New-FixtureApp 'legacy install'; $script:Entry = New-RegistryEntry $app; $script:Entry.InstallLocation = ''
    function Get-MessengerRegistryEntries { $script:Entry }
    function Get-MessengerFileMetadata { param($Exe) $null }
    $install = & $original['Get-CodexMessengerInstall'] $repo
    Assert-Equal $install.InstallDir $app; Assert-Equal $install.Version '0.0.4'
  }
  Test-Case 'installed application launches before any Node, npm or Codex login check' {
    $app = New-FixtureApp 'installed without node'; $script:LaunchCalls = @()
    function Get-CodexMessengerInstall { param($RepoRoot) [pscustomobject]@{ Exe = (Join-Path $app 'Codex Messenger.exe'); InstallDir = $app } }
    function Resolve-LauncherNode { throw 'Node must not be resolved for an installed app' }
    function Invoke-SourceLauncher { param($RepoRoot, $Mode) throw 'Source bootstrap must not run' }
    function Start-Process { [CmdletBinding()]param($FilePath, $WorkingDirectory)
      $script:LaunchCalls += [pscustomobject]@{ Exe = $FilePath; Directory = $WorkingDirectory }
    }
    Assert-Equal (Start-MessengerApplication $repo) 0
    Assert-Equal $script:LaunchCalls.Count 1; Assert-Equal $script:LaunchCalls[0].Directory $app
  }
  Test-Case 'latest release reads published stable GitHub metadata and handles unavailable or unsafe replies' {
    $script:Release = [pscustomobject]@{ draft = $false; prerelease = $false; tag_name = 'v0.0.4'; html_url = 'https://github.com/anisayari/codex-messenger/releases/tag/v0.0.4' }
    function Invoke-RestMethod { [CmdletBinding()]param($Uri, $Headers, $TimeoutSec)
      Assert-Equal $Uri 'https://api.github.com/repos/anisayari/codex-messenger/releases/latest'
      Assert-Equal $TimeoutSec 8; return $script:Release
    }
    Assert-Equal (Get-LatestMessengerRelease).Version '0.0.4'
    $script:Release.prerelease = $true; Assert-Equal (Get-LatestMessengerRelease) $null
    $script:Release.prerelease = $false; $script:Release.draft = $true; Assert-Equal (Get-LatestMessengerRelease) $null
    $script:Release.draft = $false; $script:Release.html_url = 'https://example.com/fake'; Assert-Equal (Get-LatestMessengerRelease) $null
    function Invoke-RestMethod { [CmdletBinding()]param($Uri, $Headers, $TimeoutSec) throw 'offline' }
    Assert-Equal (Get-LatestMessengerRelease) $null
  }
  Test-Case 'Node compatibility follows the package range without accepting old or unknown runtimes' {
    foreach ($version in @('v20.19.0', '20.20.2', '22.12.0', '24.15.0', '26.0.0')) { Assert-True (Test-NodeEngineVersion $version '^20.19.0 || >=22.12.0') $version }
    foreach ($version in @('20.18.9', '21.7.3', '22.11.0', '18.20.8', 'v24.0.0-rc.1', 'unknown')) { Assert-False (Test-NodeEngineVersion $version '^20.19.0 || >=22.12.0') $version }
    Assert-Throws { Test-NodeEngineVersion '24.15.0' '>=20 <22' } 'Cannot validate'
  }
  Test-Case 'source runtime compatibility follows the actual locked Electron package range' {
    $range = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).engines.node
    Assert-Equal $range '>=22.12.0'
    foreach ($version in @('22.12.0', '24.15.0', '26.0.0')) { Assert-True (Test-NodeEngineVersion $version $range) $version }
    foreach ($version in @('20.19.0', '20.20.2', '22.11.0')) { Assert-False (Test-NodeEngineVersion $version $range) $version }
  }
  Test-Case 'real native process returns a scalar exit code, visible stdout and restores working directory' {
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $nativeScripts = New-FixtureDirectory 'native scripts with spaces & retro'
    $stdoutScript = Join-Path $nativeScripts 'stdout exit 0.mjs'
    $stderrScript = Join-Path $nativeScripts 'stderr exit 23.mjs'
    # Source launchers pass an actual .mjs path. Embedded double quotes in -e
    # are rewritten by Windows PowerShell 5.1's legacy native argument mode.
    # Exercise real spaced paths and literal arguments without eval or a shell.
    Write-FixtureFile $stdoutScript "if(process.argv[2]!=='with spaces'||process.argv[3]!=='literal & | ;')process.exit(42);console.log('launcher fixture stdout');process.exit(0);"
    Write-FixtureFile $stderrScript "console.error('launcher fixture stderr');process.exit(23);"
    $before = (Get-Location).Path; $global:LASTEXITCODE = 37
    $result = & $original['Invoke-LauncherNative'] $node @($stdoutScript, 'with spaces', 'literal & | ;') $fixtureRoot
    Assert-Equal @($result).Count 1; Assert-Equal $result 0; Assert-Equal (Get-Location).Path $before
    Assert-Equal (& $original['Invoke-LauncherNative'] $node @($stderrScript) $fixtureRoot) 23
    $global:LASTEXITCODE = 37
    Assert-True ((Get-LauncherNodeVersion $node) -match '^v\d+\.\d+\.\d+$') 'Actual Node version'
  }
  Test-Case 'Node and npm resolve executable paths and adjacent npm.cmd without assuming a global installation' {
    $toolDirectory = New-FixtureDirectory 'runtime with spaces'
    $node = Join-Path $toolDirectory 'node.exe'; $npm = Join-Path $toolDirectory 'npm.cmd'
    Write-FixtureFile $node; Write-FixtureFile $npm
    function Get-Command { [CmdletBinding()]param($Name, $CommandType)
      if ($Name -eq 'node.exe') { [pscustomobject]@{ Source = $node } }
    }
    Assert-Equal (Resolve-LauncherNode) $node; Assert-Equal (Resolve-LauncherNpm $node) $npm
  }
  foreach ($mode in @('app', 'preview')) {
    Test-Case "source $mode installs locked dependencies once, delegates the real helper and preserves its exit" {
      $source = New-FixtureDirectory ('source-' + $mode)
      Write-FixtureFile (Join-Path $source 'package.json') '{"version":"0.0.4","engines":{"node":"^20.19.0 || >=22.12.0"}}'
      Write-FixtureFile (Join-Path $source 'package-lock.json') '{}'
      Write-FixtureFile (Join-Path $source 'scripts\dev-electron.mjs')
      Write-FixtureFile (Join-Path $source 'scripts\web-preview.mjs')
      $script:SourceCalls = @(); $script:DependencyCalls = 0
      function Resolve-LauncherNode { 'fixture-node.exe' }
      function Get-LauncherNodeVersion { param($Node) 'v24.15.0' }
      function Resolve-LauncherNpm { param($Node) 'fixture-npm.cmd' }
      function Test-LauncherDependencies { param($RepoRoot, $Node, [bool]$RequireElectron)
        Assert-Equal $RequireElectron ($mode -eq 'app'); $script:DependencyCalls++; return $script:DependencyCalls -gt 1
      }
      function Invoke-LauncherNative { param($Command, [string[]]$Arguments, $WorkingDirectory)
        $script:SourceCalls += [pscustomobject]@{ Command = $Command; Arguments = $Arguments; Directory = $WorkingDirectory }
        if ($Command -eq 'fixture-npm.cmd') { return 0 }; return 23
      }
      Assert-Equal (& $original['Invoke-SourceLauncher'] $source $mode) 23
      Assert-Equal $script:SourceCalls.Count 2; Assert-Equal $script:SourceCalls[0].Command 'fixture-npm.cmd'
      Assert-Equal ($script:SourceCalls[0].Arguments -join ' ') 'ci'
      $helper = if ($mode -eq 'app') { 'scripts\dev-electron.mjs' } else { 'scripts\web-preview.mjs' }
      Assert-Equal $script:SourceCalls[1].Arguments[0] (Join-Path $source $helper)
      Assert-Equal $script:SourceCalls[1].Directory $source
    }
  }
  Test-Case 'failed npm ci returns its exit without starting a helper or claiming success' {
    $source = New-FixtureDirectory 'source npm failure'; Write-FixtureFile (Join-Path $source 'package.json') '{"engines":{"node":">=22.12.0"}}'
    Write-FixtureFile (Join-Path $source 'package-lock.json') '{}'; $script:NativeCalls = 0
    function Resolve-LauncherNode { 'node.exe' }; function Get-LauncherNodeVersion { param($Node) '24.15.0' }
    function Resolve-LauncherNpm { param($Node) 'npm.cmd' }; function Test-LauncherDependencies { param($RepoRoot, $Node, $RequireElectron) $false }
    function Invoke-LauncherNative { param($Command, $Arguments, $WorkingDirectory) $script:NativeCalls++; Assert-Equal $Command 'npm.cmd'; return 17 }
    Assert-Equal (& $original['Invoke-SourceLauncher'] $source 'app') 17; Assert-Equal $script:NativeCalls 1
  }
  Test-Case 'unsupported Node fails before dependency installation or source launch' {
    $source = New-FixtureDirectory 'old node'; Write-FixtureFile (Join-Path $source 'package.json') '{"engines":{"node":"^20.19.0 || >=22.12.0"}}'
    function Resolve-LauncherNode { 'node.exe' }; function Get-LauncherNodeVersion { param($Node) '20.18.0' }
    function Test-LauncherDependencies { throw 'Dependencies must not be touched' }
    Assert-Throws { & $original['Invoke-SourceLauncher'] $source 'app' } 'does not satisfy'
  }
  Test-Case 'healthy locked source launches without npm and incomplete successful install produces a visible error' {
    $source = New-FixtureDirectory 'source healthy'; Write-FixtureFile (Join-Path $source 'package.json') '{"engines":{"node":">=22.12.0"}}'
    Write-FixtureFile (Join-Path $source 'package-lock.json') '{}'; Write-FixtureFile (Join-Path $source 'scripts\dev-electron.mjs')
    function Resolve-LauncherNode { 'node.exe' }; function Get-LauncherNodeVersion { param($Node) '24.15.0' }
    function Resolve-LauncherNpm { throw 'npm must not be resolved when locked dependencies already work' }
    function Test-LauncherDependencies { param($RepoRoot, $Node, $RequireElectron) $true }
    function Invoke-LauncherNative { param($Command, $Arguments, $WorkingDirectory) Assert-Equal $Command 'node.exe'; return 0 }
    Assert-Equal (& $original['Invoke-SourceLauncher'] $source 'app') 0
    function Resolve-LauncherNpm { 'npm.cmd' }; function Test-LauncherDependencies { param($RepoRoot, $Node, $RequireElectron) $false }
    function Invoke-LauncherNative { param($Command, $Arguments, $WorkingDirectory) Assert-Equal $Command 'npm.cmd'; return 0 }
    Assert-Throws { & $original['Invoke-SourceLauncher'] $source 'app' } 'required locked packages'
  }
  Test-Case 'missing lock or npm fails before source execution' {
    $source = New-FixtureDirectory 'missing source tools'; Write-FixtureFile (Join-Path $source 'package.json') '{"engines":{"node":">=22.12.0"}}'
    function Resolve-LauncherNode { 'node.exe' }; function Get-LauncherNodeVersion { param($Node) '24.15.0' }
    Assert-Throws { & $original['Invoke-SourceLauncher'] $source 'app' } 'package-lock.json is required'
    Write-FixtureFile (Join-Path $source 'package-lock.json') '{}'
    function Test-LauncherDependencies { param($RepoRoot, $Node, $RequireElectron) $false }
    function Resolve-LauncherNpm { throw 'npm.cmd was not found' }
    Assert-Throws { & $original['Invoke-SourceLauncher'] $source 'app' } 'npm.cmd was not found'
  }
  Test-Case 'real dependency check detects missing transitive packages, stale lock and missing Electron executable' {
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $source = New-FixtureDirectory 'locked dependencies'
    Write-FixtureFile (Join-Path $source 'package.json') '{"dependencies":{"direct":"1.0.0"}}'
    Write-FixtureFile (Join-Path $source 'package-lock.json') '{"packages":{"":{"name":"fixture"},"node_modules/direct":{"version":"1.0.0"},"node_modules/transitive":{"version":"2.0.0"},"node_modules/optional":{"version":"1.0.0","optional":true}}}'
    Write-FixtureFile (Join-Path $source 'node_modules\.package-lock.json') '{"packages":{"node_modules/direct":{"version":"1.0.0"},"node_modules/transitive":{"version":"2.0.0"}}}'
    Write-FixtureFile (Join-Path $source 'node_modules\direct\package.json') '{"version":"1.0.0"}'
    Assert-False (& $original['Test-LauncherDependencies'] $source $node $false)
    Write-FixtureFile (Join-Path $source 'node_modules\transitive\package.json') '{"version":"2.0.0"}'
    Assert-True (& $original['Test-LauncherDependencies'] $source $node $false)
    Assert-False (& $original['Test-LauncherDependencies'] $source $node $true)
    Write-FixtureFile (Join-Path $source 'node_modules\electron\dist\electron.exe')
    Assert-True (& $original['Test-LauncherDependencies'] $source $node $true)
    Write-FixtureFile (Join-Path $source 'node_modules\transitive\package.json') '{"version":"9.9.9"}'
    Assert-False (& $original['Test-LauncherDependencies'] $source $node $false)
  }
  Test-Case 'identified private portable app removes only its exact folder and matching shortcuts' {
    $app = New-FixtureApp 'portable positive'; $script:Removed = @()
    $sameShortcut = Join-Path $fixtureRoot 'same app.lnk'; $otherShortcut = Join-Path $fixtureRoot 'other app.lnk'
    Write-FixtureFile $sameShortcut; Write-FixtureFile $otherShortcut
    function Get-PortableMessengerDirectories { $app }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    function Get-MessengerShortcuts { @($sameShortcut, $otherShortcut) }
    function Get-MessengerShortcutTarget { param($Shortcut)
      if ($Shortcut -eq $sameShortcut) { return (Join-Path $app 'Codex Messenger.exe') }; return (Join-Path $fixtureRoot 'other.exe')
    }
    function Remove-Item { [CmdletBinding()]param($LiteralPath, [switch]$Recurse, [switch]$Force) $script:Removed += $LiteralPath }
    Assert-True (Test-PortableMessengerInstall $app); Assert-True (Remove-PortableInstall $app)
    Assert-Equal $script:Removed.Count 2; Assert-Equal $script:Removed[0] $app; Assert-Equal $script:Removed[1] $sameShortcut
    Assert-True (Microsoft.PowerShell.Management\Test-Path -LiteralPath $otherShortcut)
  }
  Test-Case 'portable deletion refuses a root, parent, sibling or unapproved custom directory' {
    $app = New-FixtureApp 'portable exact'; function Get-PortableMessengerDirectories { $app }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    foreach ($directory in @($fixtureRoot, [IO.Path]::GetPathRoot($app), ($app + '-sibling'), (New-FixtureApp 'custom unapproved'))) {
      Assert-False (Remove-PortableInstall $directory) $directory
    }
  }
  foreach ($failure in @('shared-file', 'wrong-product', 'missing-asar', 'unexpected-resources', 'reparse-leaf', 'reparse-parent')) {
    Test-Case "portable deletion refuses $failure without a remove side effect" {
      $app = New-FixtureApp ('portable-' + $failure); function Get-PortableMessengerDirectories { $app }
      function Get-MessengerFileMetadata { param($Exe)
        $name = if ($failure -eq 'wrong-product') { 'Other Product' } else { 'Codex Messenger' }; [pscustomobject]@{ ProductName = $name }
      }
      if ($failure -eq 'shared-file') { Write-FixtureFile (Join-Path $app 'my-project.txt') 'preserve me' }
      if ($failure -eq 'missing-asar') { Microsoft.PowerShell.Management\Remove-Item -LiteralPath (Join-Path $app 'resources\app.asar') }
      if ($failure -eq 'unexpected-resources') { Write-FixtureFile (Join-Path $app 'resources\user-data.txt') }
      if ($failure -like 'reparse-*') {
        function Get-Item { [CmdletBinding()]param($LiteralPath, [switch]$Force)
          $blocked = if ($failure -eq 'reparse-leaf') { $app } else { [IO.Path]::GetDirectoryName($app) }
          if ($LiteralPath -eq $blocked) { return [pscustomobject]@{ Attributes = [IO.FileAttributes]::ReparsePoint } }
          return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
        }
      }
      Assert-False (Remove-PortableInstall $app); Assert-True (Microsoft.PowerShell.Management\Test-Path -LiteralPath $app)
    }
  }
  if ($env:OS -eq 'Windows_NT') {
    Test-Case 'native NTFS junction at the app or an ancestor is refused and its target survives' {
      $target = New-FixtureApp 'actual junction target'
      $link = Join-Path $fixtureRoot 'actual junction'
      $parentLink = Join-Path $fixtureRoot 'actual parent junction'
      try {
        Microsoft.PowerShell.Management\New-Item -ItemType Junction -Path $link -Value $target | Out-Null
        Microsoft.PowerShell.Management\New-Item -ItemType Junction -Path $parentLink -Value $fixtureRoot | Out-Null
        function Get-PortableMessengerDirectories { @($link, (Join-Path $parentLink 'actual junction target')) }
        function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
        Assert-False (Remove-PortableInstall $link)
        Assert-False (Remove-PortableInstall (Join-Path $parentLink 'actual junction target'))
        Assert-True (Microsoft.PowerShell.Management\Test-Path -LiteralPath (Join-Path $target 'Codex Messenger.exe'))
      } finally {
        # Delete the junction entries, never recursively traverse their targets.
        if ([IO.Directory]::Exists($link)) { [IO.Directory]::Delete($link) }
        if ([IO.Directory]::Exists($parentLink)) { [IO.Directory]::Delete($parentLink) }
      }
    }
  }
  Test-Case 'registered NSIS uninstaller runs an exact verified private copy with trailing raw InstallDir and preserves failure' {
    $install = New-FixtureRegisteredUninstall 'uninstaller with spaces'
    $script:UninstallExit = 17; $script:UninstallCopies = @()
    function Get-MessengerRegistryEntries { $script:UninstallEntry }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    function Start-Process { [CmdletBinding()]param($FilePath, $WorkingDirectory, $ArgumentList, [switch]$Wait, [switch]$PassThru)
      Assert-False ($FilePath -eq $script:UninstallOriginal)
      Assert-False ($WorkingDirectory -eq $script:UninstallApp)
      Assert-Equal ([IO.Path]::GetDirectoryName($FilePath)) $WorkingDirectory
      Assert-True (([IO.Path]::GetFileName($WorkingDirectory)) -match '^codex-messenger-uninstall-[a-f0-9]{32}$')
      Assert-Equal (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash (Get-FileHash -LiteralPath $script:UninstallOriginal -Algorithm SHA256).Hash
      Assert-Equal $ArgumentList ('/currentuser /S _?=' + $script:UninstallApp)
      Assert-True $Wait; Assert-True $PassThru; $script:UninstallCopies += $FilePath
      [pscustomobject]@{ ExitCode = $script:UninstallExit }
    }
    Assert-Throws { Invoke-MessengerUninstaller $install } 'exited with code 17'
    $script:UninstallExit = 0; Assert-Equal (Invoke-MessengerUninstaller $install) 0
    Assert-Equal $script:UninstallCopies.Count 2
    foreach ($copy in $script:UninstallCopies) { Assert-False ([IO.File]::Exists($copy)); Assert-False ([IO.Directory]::Exists([IO.Path]::GetDirectoryName($copy))) }
    Assert-True ([IO.Directory]::Exists($script:UninstallApp)); Assert-True ([IO.File]::Exists($script:UninstallOriginal))
    $script:UninstallEntry.QuietUninstallString = ''; $script:UninstallEntry.UninstallString = '"' + $install.Exe + '"'
    Assert-Throws { Invoke-MessengerUninstaller $install } 'does not belong'
    $script:UninstallEntry.UninstallString = 'powershell.exe -Command something'; Assert-Throws { Invoke-MessengerUninstaller $install } 'absolute|does not belong'
    $install.Kind = 'unregistered'; Assert-Throws { Invoke-MessengerUninstaller $install } 'No registered uninstaller'
  }
  Test-Case 'NSIS action revalidates the real registration and rejects stale path or executable identity before copying' {
    $install = New-FixtureRegisteredUninstall 'stale uninstaller registration'
    function Get-MessengerRegistryEntries { $script:UninstallEntry }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    $script:UninstallEntry.PSChildName = 'wrong-key'; Assert-Throws { Invoke-MessengerUninstaller $install } 'expected identity'
    $script:UninstallEntry.PSChildName = '{aec7928a-9490-5305-a9b2-1a0182dfd515}'
    $script:UninstallEntry.InstallLocation = $fixtureRoot; Assert-Throws { Invoke-MessengerUninstaller $install } 'folder changed'
    $script:UninstallEntry.InstallLocation = $script:UninstallApp
    $install.Exe = Join-Path $fixtureRoot 'wrong.exe'; Assert-Throws { Invoke-MessengerUninstaller $install } 'executable no longer'
    $install.Exe = Join-Path $script:UninstallApp 'Codex Messenger.exe'
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Different app' } }
    Assert-Throws { Invoke-MessengerUninstaller $install } 'application executable'
    function Get-MessengerFileMetadata { param($Exe)
      $product = if ([IO.Path]::GetFileName($Exe) -like 'Uninstall*') { 'Different uninstaller' } else { 'Codex Messenger' }
      [pscustomobject]@{ ProductName = $product }
    }
    Assert-Throws { Invoke-MessengerUninstaller $install } 'unexpected product identity'
  }
  Test-Case 'NSIS registry arguments cannot inject a command, override InstallDir, duplicate flags or change registry scope' {
    $install = New-FixtureRegisteredUninstall 'unsafe registry arguments'
    function Get-MessengerRegistryEntries { $script:UninstallEntry }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    foreach ($unsafe in @('/S & calc.exe', '/S _?=another', '/S /S', '/currentuser /allusers', '/allusers /S', '/S "extra"')) {
      $script:UninstallEntry.QuietUninstallString = '"' + $script:UninstallOriginal + '" ' + $unsafe
      Assert-Throws { Invoke-MessengerUninstaller $install } 'unsupported argument|duplicate arguments|conflicting user scopes|scope does not match'
    }
    $script:UninstallEntry.QuietUninstallString = '"' + (Join-Path $fixtureRoot 'Uninstall Codex Messenger.exe') + '" /S'
    Assert-Throws { Invoke-MessengerUninstaller $install } 'does not belong'
  }
  Test-Case 'private uninstaller copy is cleaned when process creation fails without deleting the installation' {
    $install = New-FixtureRegisteredUninstall 'process creation failure'; $script:FailedCopy = ''
    function Get-MessengerRegistryEntries { $script:UninstallEntry }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    function Start-Process { [CmdletBinding()]param($FilePath, $WorkingDirectory, $ArgumentList, [switch]$Wait, [switch]$PassThru)
      $script:FailedCopy = $FilePath; throw 'Fixture process creation denied'
    }
    Assert-Throws { Invoke-MessengerUninstaller $install } 'Fixture process creation denied'
    Assert-True $script:FailedCopy; Assert-False ([IO.File]::Exists($script:FailedCopy))
    Assert-False ([IO.Directory]::Exists([IO.Path]::GetDirectoryName($script:FailedCopy)))
    Assert-True ([IO.File]::Exists($script:UninstallOriginal))
  }
  Test-Case 'changed copied bytes are preserved rather than deleting an unverified temporary file' {
    $install = New-FixtureRegisteredUninstall 'tampered private copy'; $script:TamperedCopy = ''
    function Get-MessengerRegistryEntries { $script:UninstallEntry }
    function Get-MessengerFileMetadata { param($Exe) [pscustomobject]@{ ProductName = 'Codex Messenger' } }
    function Start-Process { [CmdletBinding()]param($FilePath, $WorkingDirectory, $ArgumentList, [switch]$Wait, [switch]$PassThru)
      $script:TamperedCopy = $FilePath; [IO.File]::WriteAllText($FilePath, 'changed bytes'); [pscustomobject]@{ ExitCode = 0 }
    }
    try {
      Assert-Throws { Invoke-MessengerUninstaller $install } 'copy changed identity'
      Assert-Equal ([IO.File]::ReadAllText($script:TamperedCopy)) 'changed bytes'
      Assert-True ([IO.File]::Exists($script:UninstallOriginal))
    } finally {
      # Fixture-owned bytes are removed explicitly by the fixture, not the launcher.
      if ($script:TamperedCopy) { [IO.File]::Delete($script:TamperedCopy); [IO.Directory]::Delete([IO.Path]::GetDirectoryName($script:TamperedCopy)) }
    }
  }
  Test-Case 'both root wrappers forward NoUi and actual success/failure exits independently of stale LASTEXITCODE' {
    $psExecutable = if ($env:OS -eq 'Windows_NT' -and $PSVersionTable.PSEdition -ne 'Core') { Join-Path $PSHOME 'powershell.exe' } elseif ($env:OS -eq 'Windows_NT') { Join-Path $PSHOME 'pwsh.exe' } else { Join-Path $PSHOME 'pwsh' }
    foreach ($wrapper in @('launch-codex-messenger.ps1', 'launch-web-preview.ps1')) {
      $tempRepo = New-FixtureDirectory ('wrapper-' + $wrapper)
      Write-FixtureFile (Join-Path $tempRepo $wrapper) ([IO.File]::ReadAllText((Join-Path $repo $wrapper)))
      $platform = Join-Path $tempRepo ('launchers\windows\' + $wrapper)
      foreach ($exitCode in @(0, 23)) {
        Write-FixtureFile $platform ('param([switch]$NoUi); if (!$NoUi) { throw "NoUi was not forwarded" }; exit ' + $exitCode)
        $quoted = (Join-Path $tempRepo $wrapper).Replace("'", "''")
        $command = '$global:LASTEXITCODE=37; & ''' + $quoted + ''' -NoUi; exit $LASTEXITCODE'
        & $psExecutable -NoProfile -ExecutionPolicy Bypass -Command $command | Out-Host
        Assert-Equal $LASTEXITCODE $exitCode $wrapper
      }
      Microsoft.PowerShell.Management\Remove-Item -LiteralPath $platform
      $oldPreference = $ErrorActionPreference
      try {
        # Windows PowerShell 5.1 represents native stderr as ErrorRecords.
        $ErrorActionPreference = 'Continue'
        & $psExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tempRepo $wrapper) -NoUi 2>&1 | Out-Host
      } finally { $ErrorActionPreference = $oldPreference }
      Assert-Equal $LASTEXITCODE 1 'missing platform script'
    }
  }
} finally {
  Microsoft.PowerShell.Management\Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "Windows launcher fixtures: $script:Passed passed, $script:Failed failed"
if ($script:Failed -ne 0) { exit 1 }
exit 0
