$ErrorActionPreference = 'Stop'

function Get-LauncherPackage {
  param([string]$RepoRoot)
  $path = Join-Path $RepoRoot 'package.json'
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "package.json was not found: $path" }
  return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
}

function Get-NormalizedLauncherPath {
  param([string]$Path)
  if (!$Path -or ![System.IO.Path]::IsPathRooted($Path)) { throw 'An absolute filesystem path is required.' }
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) { return $root }
  return $full.TrimEnd([char[]]@('\', '/'))
}

function Get-MessengerExecutable {
  param([string]$InstallDir)
  if (!$InstallDir) { return $null }
  foreach ($name in @('Codex Messenger.exe', 'CodexMessenger.exe')) {
    $exe = Join-Path $InstallDir $name
    if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
  }
  return $null
}

function Get-MessengerFileMetadata {
  param([string]$Exe)
  try { return [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Exe) } catch { return $null }
}

function Get-MessengerFileVersion {
  param([string]$Exe)
  $metadata = Get-MessengerFileMetadata $Exe
  if ($metadata -and $metadata.ProductVersion) { return $metadata.ProductVersion }
  return ''
}

function Test-MessengerRegistryIdentity {
  param($Entry)
  if (!$Entry -or [string]$Entry.DisplayName -notmatch '^Codex Messenger(?: \d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)?$') { return $false }
  $key = [string]$Entry.PSChildName
  if (!$key -and $Entry.PSPath) { $key = ([string]$Entry.PSPath -split '\\')[-1] }
  # electron-builder derives this stable NSIS GUID from com.codex.messenger.
  if ($key) { return $key.Trim('{', '}').Equals('aec7928a-9490-5305-a9b2-1a0182dfd515', [System.StringComparison]::OrdinalIgnoreCase) }
  # Compatibility with an older property record without provider metadata.
  return $Entry.DisplayName -eq 'Codex Messenger'
}

function Get-MessengerRegistryEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) { continue }
    foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
      $props = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
      if (Test-MessengerRegistryIdentity $props) { $props }
    }
  }
}

function Get-MessengerInstallCandidates {
  param([string]$RepoRoot)
  $directories = @()
  if ($env:LOCALAPPDATA) {
    $directories += Join-Path $env:LOCALAPPDATA 'Programs\Codex Messenger'
    $directories += Join-Path $env:LOCALAPPDATA 'Programs\codex-messenger'
  }
  foreach ($parent in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($parent) { $directories += Join-Path $parent 'Codex Messenger' }
  }
  $directories += Join-Path $RepoRoot 'release\windows\win-unpacked'
  $directories += Join-Path $RepoRoot 'release\win-unpacked'
  return $directories | Select-Object -Unique
}

function ConvertFrom-MessengerUninstallCommand {
  param([string]$CommandLine)
  if (!$CommandLine) { return $null }
  if ($CommandLine -match '^\s*"([^\"]+)"\s*(.*)$') {
    return [pscustomobject]@{ Exe = $matches[1]; Arguments = $matches[2] }
  }
  if ($CommandLine -match '^\s*([^\s]+\.exe)(?:\s+(.*))?\s*$') {
    return [pscustomobject]@{ Exe = $matches[1]; Arguments = $matches[2] }
  }
  throw 'The registered uninstaller command is not a supported executable command.'
}

function Get-CodexMessengerInstall {
  param([string]$RepoRoot)
  foreach ($entry in @(Get-MessengerRegistryEntries)) {
    if (!(Test-MessengerRegistryIdentity $entry)) { continue }
    $directory = [string]$entry.InstallLocation
    if (!$directory) {
      try {
        $command = ConvertFrom-MessengerUninstallCommand ([string]$entry.UninstallString)
        if ($command) { $directory = [System.IO.Path]::GetDirectoryName($command.Exe) }
      } catch { continue }
    }
    if (!$directory) { continue }
    try { $directory = Get-NormalizedLauncherPath $directory } catch { continue }
    $exe = Get-MessengerExecutable $directory
    if (!$exe) { continue }
    $version = Get-MessengerFileVersion $exe
    if (!$version) { $version = [string]$entry.DisplayVersion }
    return [pscustomobject]@{
      Installed = $true; Kind = 'registered'; Version = $version; Exe = $exe
      InstallDir = $directory; RegistryPath = [string]$entry.PSPath
      UninstallString = [string]$entry.UninstallString
      QuietUninstallString = [string]$entry.QuietUninstallString
    }
  }
  foreach ($directory in @(Get-MessengerInstallCandidates $RepoRoot)) {
    $exe = Get-MessengerExecutable $directory
    if (!$exe) { continue }
    $kind = if (Test-PortableMessengerInstall $directory) { 'portable' } else { 'unregistered' }
    return [pscustomobject]@{
      Installed = $true; Kind = $kind; Version = (Get-MessengerFileVersion $exe); Exe = $exe
      InstallDir = $directory; RegistryPath = ''; UninstallString = ''; QuietUninstallString = ''
    }
  }
  return [pscustomobject]@{
    Installed = $false; Kind = 'source'; Version = [string](Get-LauncherPackage $RepoRoot).version
    Exe = ''; InstallDir = ''; RegistryPath = ''; UninstallString = ''; QuietUninstallString = ''
  }
}

function Get-LatestMessengerRelease {
  try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/anisayari/codex-messenger/releases/latest' -Headers @{ 'User-Agent' = 'CodexMessenger-WindowsLauncher'; Accept = 'application/vnd.github+json' } -TimeoutSec 8
    if ($release.draft -ne $false -or $release.prerelease -ne $false) { return $null }
    if ([string]$release.tag_name -notmatch '^v?(\d+\.\d+\.\d+)$') { return $null }
    $version = $matches[1]
    $url = [string]$release.html_url
    if ($url -notmatch '^https://github\.com/anisayari/codex-messenger/releases/tag/[^/?#]+$') { return $null }
    return [pscustomobject]@{ Version = $version; Url = $url }
  } catch { return $null }
}

function Resolve-LauncherNode {
  $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  foreach ($parent in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (!$parent) { continue }
    $candidate = Join-Path $parent 'nodejs\node.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'Node.js is required only for source mode. Install a version compatible with package.json, or use the Windows release.'
}

function Resolve-LauncherNpm {
  param([string]$Node)
  $command = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  $candidates = @(Join-Path ([System.IO.Path]::GetDirectoryName($Node)) 'npm.cmd')
  if ($env:APPDATA) { $candidates += Join-Path $env:APPDATA 'npm\npm.cmd' }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'npm.cmd was not found. Reinstall Node.js with npm, or use the Windows release.'
}

function Test-NodeEngineVersion {
  param([string]$Version, [string]$Range)
  if ($Version -notmatch '^v?(\d+\.\d+\.\d+)$') { return $false }
  $actual = [version]$matches[1]
  foreach ($alternative in ($Range -split '\s*\|\|\s*')) {
    if ($alternative -notmatch '^(\^|>=|=)?(\d+\.\d+\.\d+)$') {
      throw "Cannot validate the Node.js engine requirement: $Range"
    }
    $operator = $matches[1]; $minimum = [version]$matches[2]
    if ($operator -eq '>=' -and $actual -ge $minimum) { return $true }
    if ($operator -eq '^' -and $minimum.Major -gt 0 -and $actual.Major -eq $minimum.Major -and $actual -ge $minimum) { return $true }
    if (!$operator -or $operator -eq '=') { if ($actual -eq $minimum) { return $true } }
  }
  return $false
}

function Invoke-LauncherNative {
  param([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory)
  $previousLocation = Get-Location
  $previousPreference = $ErrorActionPreference
  try {
    if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
    # Native stderr is diagnostic output; use the real exit code for success.
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    & $Command @Arguments | Out-Host
    if ($null -eq $global:LASTEXITCODE) { throw "The command could not be executed: $Command" }
    return [int]$global:LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    Set-Location -LiteralPath $previousLocation.Path
  }
}

function Test-LauncherDependencies {
  param([string]$RepoRoot, [string]$Node, [bool]$RequireElectron = $true)
  $check = @'
const fs=require('node:fs'),path=require('node:path');const root=process.argv[1];
try {
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const pkg=read('package.json'),lock=read('package-lock.json'),hidden=read('node_modules/.package-lock.json');
  if(!lock.packages||!hidden.packages)process.exit(1);
  const installed=key=>{const expected=lock.packages[key],item=hidden.packages[key],actual=read(key+'/package.json');if(!expected||!item||item.version!==expected.version||actual.version!==expected.version||(item.integrity&&expected.integrity&&item.integrity!==expected.integrity))process.exit(1);};
  for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies}))installed('node_modules/'+name);
  const compatible=(values,current)=>!values||(!values.includes('!'+current)&&(!values.some(value=>!value.startsWith('!'))||values.includes(current)));
  for(const [key,item]of Object.entries(lock.packages))if(key&&!item.optional&&compatible(item.os,process.platform)&&compatible(item.cpu,process.arch))installed(key);
  for(const key of Object.keys(hidden.packages))installed(key);
  if(process.argv[2]==='1'&&!fs.existsSync(path.join(root,'node_modules/electron/dist/electron.exe')))process.exit(1);
  process.exit(0);
}catch{process.exit(1);}
'@
  $electronFlag = if ($RequireElectron) { '1' } else { '0' }
  $code = Invoke-LauncherNative $Node @('-e', $check, $RepoRoot, $electronFlag) $RepoRoot
  return $code -eq 0
}

function Get-LauncherNodeVersion {
  param([string]$Node)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    $version = (& $Node --version | Out-String).Trim()
    $versionExit = $global:LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($null -eq $versionExit -or $versionExit -ne 0) { throw "Could not read the Node.js version: $Node" }
  return $version
}

function Invoke-SourceLauncher {
  param([string]$RepoRoot, [ValidateSet('app', 'preview')][string]$Mode)
  $package = Get-LauncherPackage $RepoRoot
  $node = Resolve-LauncherNode
  $version = Get-LauncherNodeVersion $node
  if (!(Test-NodeEngineVersion $version ([string]$package.engines.node))) {
    throw "Node.js $version does not satisfy package.json engines.node ($($package.engines.node))."
  }
  if (!(Test-Path -LiteralPath (Join-Path $RepoRoot 'package-lock.json') -PathType Leaf)) { throw 'package-lock.json is required for reproducible source installation.' }
  $requireElectron = $Mode -eq 'app'
  if (!(Test-LauncherDependencies $RepoRoot $node $requireElectron)) {
    $npm = Resolve-LauncherNpm $node
    Write-Host 'Installing the source dependencies from package-lock.json...'
    $installCode = Invoke-LauncherNative $npm @('ci') $RepoRoot
    if ($installCode -ne 0) { return $installCode }
    if (!(Test-LauncherDependencies $RepoRoot $node $requireElectron)) { throw 'Dependency installation finished, but the required locked packages or Electron executable are unavailable.' }
  }
  $script = if ($Mode -eq 'preview') { 'scripts\web-preview.mjs' } else { 'scripts\dev-electron.mjs' }
  $scriptPath = Join-Path $RepoRoot $script
  if (!(Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "The source launcher helper was not found: $scriptPath" }
  return Invoke-LauncherNative $node @($scriptPath) $RepoRoot
}

function Start-MessengerApplication {
  param([string]$RepoRoot)
  $install = Get-CodexMessengerInstall $RepoRoot
  if ($install.Exe) {
    Start-Process -FilePath $install.Exe -WorkingDirectory $install.InstallDir -ErrorAction Stop | Out-Null
    return 0
  }
  return Invoke-SourceLauncher $RepoRoot 'app'
}

function Get-PortableMessengerDirectories {
  $directories = @()
  if ($env:LOCALAPPDATA) {
    $directories += Join-Path $env:LOCALAPPDATA 'Programs\Codex Messenger'
    $directories += Join-Path $env:LOCALAPPDATA 'Programs\codex-messenger'
  }
  foreach ($parent in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($parent) { $directories += Join-Path $parent 'Codex Messenger' }
  }
  return $directories
}

function Test-PortableMessengerInstall {
  param([string]$InstallDir)
  try {
    $resolved = Get-NormalizedLauncherPath $InstallDir
    $allowed = @(Get-PortableMessengerDirectories | ForEach-Object { Get-NormalizedLauncherPath $_ })
    if (!($allowed | Where-Object { $_.Equals($resolved, [System.StringComparison]::OrdinalIgnoreCase) })) { return $false }
    $ancestor = $resolved
    while ($ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      $parent = [System.IO.Path]::GetDirectoryName($ancestor)
      if (!$parent -or $parent -eq $ancestor) { break }
      $ancestor = $parent
    }
    $exe = Get-MessengerExecutable $resolved
    if (!$exe) { return $false }
    $metadata = Get-MessengerFileMetadata $exe
    if (!$metadata -or $metadata.ProductName -ne 'Codex Messenger') { return $false }
    if (!(Test-Path -LiteralPath (Join-Path $resolved 'resources\app.asar') -PathType Leaf)) { return $false }
    $allowedFiles = @('Codex Messenger.exe', 'CodexMessenger.exe', 'LICENSE', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'chrome_crashpad_handler.exe', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll', 'vk_swiftshader.dll', 'vulkan-1.dll', 'vk_swiftshader_icd.json')
    foreach ($item in Get-ChildItem -LiteralPath $resolved -Force) {
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      if ($item.PSIsContainer) {
        if ($item.Name -notin @('resources', 'locales')) { return $false }
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
          if ($child.PSIsContainer -or ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
          if ($item.Name -eq 'resources' -and $child.Name -ne 'app.asar') { return $false }
          if ($item.Name -eq 'locales' -and $child.Name -notmatch '^[a-zA-Z0-9_-]+\.pak$') { return $false }
        }
      } elseif ($item.Name -notin $allowedFiles) { return $false }
    }
    return $true
  } catch { return $false }
}

function Get-MessengerShortcutTarget {
  param([string]$Shortcut)
  $shell = $null; $link = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Shortcut)
    return $link.TargetPath
  } catch { return '' } finally {
    if ($link) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($link) }
    if ($shell) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
  }
}

function Get-MessengerShortcuts {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = [Environment]::GetFolderPath('StartMenu')
  if ($desktop) { Join-Path $desktop 'Codex Messenger.lnk' }
  if ($startMenu) { Join-Path $startMenu 'Programs\Codex Messenger.lnk' }
}

function Remove-PortableInstall {
  param([string]$InstallDir)
  if (!(Test-PortableMessengerInstall $InstallDir)) { return $false }
  $resolved = Get-NormalizedLauncherPath $InstallDir
  $exe = Get-NormalizedLauncherPath (Get-MessengerExecutable $resolved)
  $shortcuts = @(Get-MessengerShortcuts)
  $matchingShortcuts = @()
  foreach ($shortcut in $shortcuts) {
    if (!(Test-Path -LiteralPath $shortcut -PathType Leaf)) { continue }
    $target = Get-MessengerShortcutTarget $shortcut
    if (!$target) { continue }
    try { $target = Get-NormalizedLauncherPath $target } catch { continue }
    if ($target.Equals($exe, [System.StringComparison]::OrdinalIgnoreCase)) { $matchingShortcuts += $shortcut }
  }
  # Recheck immediately before deleting. No registry/custom/shared folder is accepted.
  if (!(Test-PortableMessengerInstall $resolved)) { return $false }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
  foreach ($shortcut in $matchingShortcuts) { Remove-Item -LiteralPath $shortcut -Force -ErrorAction Stop }
  return $true
}

function Invoke-MessengerUninstaller {
  param($Install)
  if (!$Install -or !$Install.Exe) { throw 'No installed Codex Messenger executable was found.' }
  if ($Install.Kind -eq 'portable') {
    if (!(Remove-PortableInstall $Install.InstallDir)) { throw 'This folder is not an identified private portable installation. Nothing was removed.' }
    return 0
  }
  if ($Install.Kind -ne 'registered') { throw 'No registered uninstaller was found. Use the original installer or Windows Apps settings; no folder was removed.' }
  $commandLine = if ($Install.QuietUninstallString) { $Install.QuietUninstallString } else { $Install.UninstallString }
  $command = ConvertFrom-MessengerUninstallCommand $commandLine
  if (!$command) { throw 'The installed application has no registered uninstaller. No folder was removed.' }
  $directory = Get-NormalizedLauncherPath $Install.InstallDir
  $exe = Get-NormalizedLauncherPath $command.Exe
  $uninstallerName = [System.IO.Path]::GetFileName($exe)
  if (![System.IO.Path]::GetDirectoryName($exe).Equals($directory, [System.StringComparison]::OrdinalIgnoreCase) -or $uninstallerName -notin @('Uninstall Codex Messenger.exe', 'Uninstall CodexMessenger.exe') -or !(Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'The registered uninstaller does not belong to the selected application folder. Nothing was removed.'
  }
  $options = @{ FilePath = $exe; WorkingDirectory = $directory; Wait = $true; PassThru = $true; ErrorAction = 'Stop' }
  if ($command.Arguments) { $options.ArgumentList = $command.Arguments }
  $process = Start-Process @options
  if ($process.ExitCode -ne 0) { throw "The uninstaller exited with code $($process.ExitCode). No fallback folder deletion was attempted." }
  return 0
}
