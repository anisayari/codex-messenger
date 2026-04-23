param(
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"

$releaseUrl = "https://github.com/anisayari/codex-messenger/releases"
$packageUrl = "https://raw.githubusercontent.com/anisayari/codex-messenger/main/package.json"
$nodeDownloadUrl = "https://nodejs.org/en/download"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$packagePath = Join-Path $repoRoot "package.json"

function Get-RepoVersion {
  if (!(Test-Path -LiteralPath $packagePath)) { return "" }
  try {
    return ((Get-Content -LiteralPath $packagePath -Raw) | ConvertFrom-Json).version
  } catch {
    return ""
  }
}

function Get-LatestVersion {
  try {
    return (Invoke-RestMethod -Uri $packageUrl -TimeoutSec 8).version
  } catch {
    return ""
  }
}

function Get-InstallRegistryEntry {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($root in $roots) {
    if (!(Test-Path $root)) { continue }
    foreach ($entry in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $props = Get-ItemProperty $entry.PSPath -ErrorAction SilentlyContinue
      if ($props.DisplayName -eq "Codex Messenger") { return $props }
    }
  }
  return $null
}

function Get-InstallCandidates {
  $dirs = @()
  if ($env:LOCALAPPDATA) {
    $dirs += Join-Path $env:LOCALAPPDATA "Programs\Codex Messenger"
    $dirs += Join-Path $env:LOCALAPPDATA "Programs\codex-messenger"
  }
  if ($env:ProgramFiles) {
    $dirs += Join-Path $env:ProgramFiles "Codex Messenger"
  }
  $dirs += Join-Path $repoRoot "release\windows\win-unpacked"
  $dirs += Join-Path $repoRoot "release\win-unpacked"

  foreach ($dir in $dirs | Select-Object -Unique) {
    if (!(Test-Path -LiteralPath $dir)) { continue }
    foreach ($name in @("Codex Messenger.exe", "CodexMessenger.exe")) {
      $exe = Join-Path $dir $name
      if (Test-Path -LiteralPath $exe) {
        [pscustomobject]@{
          InstallDir = $dir
          Exe = $exe
        }
      }
    }
  }
}

function Get-CodexMessengerInstall {
  $registry = Get-InstallRegistryEntry
  $candidate = Get-InstallCandidates | Select-Object -First 1
  $version = ""

  if ($registry -and $registry.DisplayVersion) {
    $version = $registry.DisplayVersion
  } elseif ($candidate -and (Test-Path -LiteralPath $candidate.Exe)) {
    try { $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($candidate.Exe).ProductVersion } catch {}
  } else {
    $version = Get-RepoVersion
  }

  [pscustomobject]@{
    Installed = [bool]($registry -or $candidate)
    Version = $version
    Exe = if ($candidate) { $candidate.Exe } else { "" }
    InstallDir = if ($candidate) { $candidate.InstallDir } elseif ($registry) { $registry.InstallLocation } else { "" }
    UninstallString = if ($registry) { $registry.UninstallString } else { "" }
    QuietUninstallString = if ($registry) { $registry.QuietUninstallString } else { "" }
  }
}

function Start-CodexMessenger {
  if (!(Test-CodexReady)) {
    Start-CodexSetup
    return
  }

  $install = Get-CodexMessengerInstall
  if ($install.Exe -and (Test-Path -LiteralPath $install.Exe)) {
    Start-Process -FilePath $install.Exe
    return
  }

  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (!$npm) {
    throw "npm.cmd was not found. Install from the GitHub release or install Node.js/npm for source mode."
  }
  Start-Process -FilePath $npm -ArgumentList @("run", "electron:dev") -WorkingDirectory $repoRoot -WindowStyle Hidden
}

function Test-CodexReady {
  $codex = (Get-Command codex -ErrorAction SilentlyContinue).Source
  if (!$codex) { return $false }
  $process = Start-Process -FilePath $codex -ArgumentList @("login", "status") -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\codex-login-status.out" -RedirectStandardError "$env:TEMP\codex-login-status.err"
  return $process.ExitCode -eq 0
}

function Start-CodexSetup {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (!$node) {
    Start-Process $nodeDownloadUrl
    throw "Node.js/npm is required to install Codex CLI. Install Node.js, then run the launcher again."
  }

  $setupScript = Join-Path $repoRoot "scripts\bootstrap-codex-env.mjs"
  if (!(Test-Path -LiteralPath $setupScript)) {
    throw "Codex setup script was not found: $setupScript"
  }

  $escapedRepoRoot = $repoRoot.ToString().Replace("'", "''")
  $command = "Set-Location -LiteralPath '$escapedRepoRoot'; node scripts/bootstrap-codex-env.mjs --ensure; Write-Host ''; Read-Host 'Setup finished. Press Enter, then launch Codex Messenger again'"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command)
}

function Invoke-UninstallString {
  param([string]$CommandLine)
  if (!$CommandLine) { return $false }
  if ($CommandLine -match '^\s*"([^"]+)"\s*(.*)$') {
    Start-Process -FilePath $matches[1] -ArgumentList $matches[2] -Wait
  } else {
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $CommandLine) -Wait
  }
  return $true
}

function Remove-PortableInstall {
  param([string]$InstallDir)
  if (!$InstallDir) { return $false }

  $resolved = [System.IO.Path]::GetFullPath($InstallDir)
  $allowedRoots = @()
  if ($env:LOCALAPPDATA) { $allowedRoots += [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs")) }
  if ($env:ProgramFiles) { $allowedRoots += [System.IO.Path]::GetFullPath($env:ProgramFiles) }
  $isAllowed = $allowedRoots | Where-Object { $resolved.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }
  if (!$isAllowed) { return $false }

  Remove-Item -LiteralPath $resolved -Recurse -Force
  foreach ($shortcut in @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex Messenger.lnk"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Codex Messenger.lnk")
  )) {
    if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
  }
  return $true
}

function Uninstall-CodexMessengerFront {
  Add-Type -AssemblyName System.Windows.Forms
  $install = Get-CodexMessengerInstall
  if (!$install.Installed) {
    [System.Windows.Forms.MessageBox]::Show("Codex Messenger does not look installed on this machine.", "Codex Messenger", "OK", "Information") | Out-Null
    return
  }

  $message = "Uninstall only the Codex Messenger front client?`n`nCodex conversations, Codex CLI data, and project files will not be touched."
  $answer = [System.Windows.Forms.MessageBox]::Show($message, "Uninstall Codex Messenger", "YesNo", "Warning")
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  $uninstallCommand = if ($install.QuietUninstallString) { $install.QuietUninstallString } else { $install.UninstallString }
  if (Invoke-UninstallString $uninstallCommand) {
    return
  }
  if (!(Remove-PortableInstall $install.InstallDir)) {
    [System.Windows.Forms.MessageBox]::Show("No safe uninstaller or install folder was found. Nothing was removed.", "Codex Messenger", "OK", "Warning") | Out-Null
  }
}

function Show-Launcher {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $install = Get-CodexMessengerInstall
  $latest = Get-LatestVersion
  $current = if ($install.Version) { $install.Version } else { Get-RepoVersion }
  $status = if ($install.Installed) { "Installed" } else { "Source / not installed" }
  $pathText = if ($install.InstallDir) { $install.InstallDir } else { $repoRoot }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "Codex Messenger Launcher"
  $form.StartPosition = "CenterScreen"
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ClientSize = New-Object System.Drawing.Size(460, 230)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = "Codex Messenger"
  $title.Font = New-Object System.Drawing.Font("Tahoma", 16, [System.Drawing.FontStyle]::Bold)
  $title.Location = New-Object System.Drawing.Point(16, 14)
  $title.Size = New-Object System.Drawing.Size(420, 28)
  $form.Controls.Add($title)

  $info = New-Object System.Windows.Forms.Label
  $info.Text = "Status: $status`r`nCurrent version: $(if ($current) { $current } else { 'unknown' })`r`nLatest version: $(if ($latest) { $latest } else { 'not checked' })`r`nPath: $pathText"
  $info.Location = New-Object System.Drawing.Point(18, 54)
  $info.Size = New-Object System.Drawing.Size(420, 72)
  $form.Controls.Add($info)

  $notice = New-Object System.Windows.Forms.Label
  $notice.Text = "Use at your own risk. Uninstall removes only the Codex Messenger front client. Codex conversations and project data are left untouched."
  $notice.Location = New-Object System.Drawing.Point(18, 132)
  $notice.Size = New-Object System.Drawing.Size(420, 36)
  $form.Controls.Add($notice)

  $launch = New-Object System.Windows.Forms.Button
  $launch.Text = "Launch"
  $launch.Location = New-Object System.Drawing.Point(18, 180)
  $launch.Size = New-Object System.Drawing.Size(90, 28)
  $launch.Add_Click({
    try {
      Start-CodexMessenger
      $form.Close()
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Launch failed", "OK", "Error") | Out-Null
    }
  })
  $form.Controls.Add($launch)

  $check = New-Object System.Windows.Forms.Button
  $check.Text = "Check updates"
  $check.Location = New-Object System.Drawing.Point(116, 180)
  $check.Size = New-Object System.Drawing.Size(108, 28)
  $check.Add_Click({
    $latestNow = Get-LatestVersion
    $currentNow = (Get-CodexMessengerInstall).Version
    [System.Windows.Forms.MessageBox]::Show("Current: $(if ($currentNow) { $currentNow } else { 'unknown' })`nLatest: $(if ($latestNow) { $latestNow } else { 'unavailable' })", "Codex Messenger updates", "OK", "Information") | Out-Null
  })
  $form.Controls.Add($check)

  $update = New-Object System.Windows.Forms.Button
  $update.Text = "Update"
  $update.Location = New-Object System.Drawing.Point(232, 180)
  $update.Size = New-Object System.Drawing.Size(76, 28)
  $update.Add_Click({ Start-Process $releaseUrl })
  $form.Controls.Add($update)

  $uninstall = New-Object System.Windows.Forms.Button
  $uninstall.Text = "Uninstall"
  $uninstall.Location = New-Object System.Drawing.Point(316, 180)
  $uninstall.Size = New-Object System.Drawing.Size(82, 28)
  $uninstall.Add_Click({ Uninstall-CodexMessengerFront })
  $form.Controls.Add($uninstall)

  $close = New-Object System.Windows.Forms.Button
  $close.Text = "Close"
  $close.Location = New-Object System.Drawing.Point(404, 180)
  $close.Size = New-Object System.Drawing.Size(42, 28)
  $close.Add_Click({ $form.Close() })
  $form.Controls.Add($close)

  [void]$form.ShowDialog()
}

if ($NoUi) {
  Start-CodexMessenger
} else {
  Show-Launcher
}
