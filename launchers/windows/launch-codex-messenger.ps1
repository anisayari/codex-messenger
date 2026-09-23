#requires -Version 5.1
param([switch]$NoUi, [switch]$TestMode)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
$script:LauncherExitCode = 0

function Show-MessengerLauncher {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $readInstall = ${function:Get-CodexMessengerInstall}
  $readRelease = ${function:Get-LatestMessengerRelease}
  $startApplication = ${function:Start-MessengerApplication}
  $runUninstaller = ${function:Invoke-MessengerUninstaller}
  $state = @{ Install = (& $readInstall $repoRoot); Latest = (& $readRelease); ExitCode = 0 }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Codex Messenger Launcher'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ClientSize = New-Object System.Drawing.Size(510, 270)
  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Codex Messenger'
  $title.Font = New-Object System.Drawing.Font('Tahoma', 16, [System.Drawing.FontStyle]::Bold)
  $title.Location = New-Object System.Drawing.Point(16, 14)
  $title.Size = New-Object System.Drawing.Size(470, 28)
  $form.Controls.Add($title)
  $info = New-Object System.Windows.Forms.Label
  $info.Location = New-Object System.Drawing.Point(18, 54)
  $info.Size = New-Object System.Drawing.Size(470, 92)
  $form.Controls.Add($info)
  $notice = New-Object System.Windows.Forms.Label
  $notice.Text = 'The installed app manages its own Codex setup. Source mode uses a visible console. Uninstall preserves Codex conversations, CLI data and projects.'
  $notice.Location = New-Object System.Drawing.Point(18, 150)
  $notice.Size = New-Object System.Drawing.Size(470, 42)
  $form.Controls.Add($notice)
  $launch = New-Object System.Windows.Forms.Button
  $launch.Text = 'Launch'
  $launch.Location = New-Object System.Drawing.Point(18, 210)
  $launch.Size = New-Object System.Drawing.Size(82, 30)
  $form.Controls.Add($launch)
  $check = New-Object System.Windows.Forms.Button
  $check.Text = 'Check updates'
  $check.Location = New-Object System.Drawing.Point(106, 210)
  $check.Size = New-Object System.Drawing.Size(105, 30)
  $form.Controls.Add($check)
  $update = New-Object System.Windows.Forms.Button
  $update.Text = 'Open release'
  $update.Location = New-Object System.Drawing.Point(217, 210)
  $update.Size = New-Object System.Drawing.Size(95, 30)
  $form.Controls.Add($update)
  $uninstall = New-Object System.Windows.Forms.Button
  $uninstall.Text = 'Uninstall'
  $uninstall.Location = New-Object System.Drawing.Point(318, 210)
  $uninstall.Size = New-Object System.Drawing.Size(82, 30)
  $form.Controls.Add($uninstall)
  $close = New-Object System.Windows.Forms.Button
  $close.Text = 'Close'
  $close.Location = New-Object System.Drawing.Point(406, 210)
  $close.Size = New-Object System.Drawing.Size(82, 30)
  $form.Controls.Add($close)
  $refresh = {
    $state.Install = & $readInstall $repoRoot
    $install = $state.Install
    $status = if (!$install.Exe) { 'Source' } elseif ($install.Kind -eq 'registered') { 'Installed' } elseif ($install.Kind -eq 'portable') { 'Portable' } else { 'Local app / no registered uninstaller' }
    $current = if ($install.Version) { $install.Version } else { 'unknown' }
    $latest = if ($state.Latest) { $state.Latest.Version } else { 'unavailable' }
    $path = if ($install.Exe) { $install.Exe } else { $repoRoot }
    $info.Text = @("Status: $status", "Current version: $current", "Latest stable release: $latest", "Path: $path") -join [Environment]::NewLine
    $uninstall.Enabled = $install.Kind -in @('registered', 'portable')
  }.GetNewClosure()
  & $refresh
  $launch.Add_Click({
    try {
      $form.Hide()
      $code = & $startApplication $repoRoot
      $state.ExitCode = [int]$code
      if ($code -ne 0) { throw "Source launch exited with code $code. See the console output." }
      $form.Close()
    } catch {
      if ($state.ExitCode -eq 0) { $state.ExitCode = 1 }
      $form.Show()
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Launch failed', 'OK', 'Error') | Out-Null
    }
  }.GetNewClosure())
  $check.Add_Click({
    try {
      $state.Latest = & $readRelease
      & $refresh
      $latest = if ($state.Latest) { $state.Latest.Version } else { 'unavailable; no update was installed' }
      [System.Windows.Forms.MessageBox]::Show("Latest stable release: $latest", 'Codex Messenger updates', 'OK', 'Information') | Out-Null
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Update check failed', 'OK', 'Error') | Out-Null
    }
  }.GetNewClosure())
  $update.Add_Click({
    try {
      $release = & $readRelease
      $url = if ($release) { $release.Url } else { 'https://github.com/anisayari/codex-messenger/releases/latest' }
      Start-Process -FilePath $url -ErrorAction Stop | Out-Null
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Could not open release', 'OK', 'Error') | Out-Null
    }
  }.GetNewClosure())
  $uninstall.Add_Click({
    try {
      $install = & $readInstall $repoRoot
      if (!$install.Exe) { throw 'The application is no longer installed.' }
      $message = @('Uninstall the Codex Messenger front client at:', $install.InstallDir, '', 'Codex conversations, CLI data and project files are preserved.') -join [Environment]::NewLine
      $answer = [System.Windows.Forms.MessageBox]::Show($message, 'Uninstall Codex Messenger', 'YesNo', 'Warning')
      if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
      $state.ExitCode = & $runUninstaller $install
      & $refresh
    } catch {
      $state.ExitCode = 1
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Uninstall failed', 'OK', 'Error') | Out-Null
      & $refresh
    }
  }.GetNewClosure())
  $close.Add_Click({ $form.Close() }.GetNewClosure())
  [void]$form.ShowDialog()
  $script:LauncherExitCode = $state.ExitCode
  $form.Dispose()
}

if ($TestMode) { return }
try {
  if ($NoUi) { $script:LauncherExitCode = Start-MessengerApplication $repoRoot } else { Show-MessengerLauncher }
  exit ([int]$script:LauncherExitCode)
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
