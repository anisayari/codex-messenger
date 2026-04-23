![Codex Messenger](public/icons/codex-messenger-readme.png)

# Codex Messenger

Codex Messenger is a Windows desktop Electron app inspired by MSN Messenger 7. It wraps a local Codex session in a Messenger-style interface: every Codex agent, project, or recent thread appears as a contact or conversation window with XP-era visuals, MSN sounds, Wizz/Nudge, file and image sending, camera capture, voice clips, profile pictures, status messages, and small games while Codex is working.

Developed by Anis AYARI and Codex.

Codex Messenger is currently supported on Windows only. French is the default language in the app, with English, Spanish, and Japanese available from the login screen.

Important: Codex Messenger is only a local front-end client for `codex app-server`. It is not Codex itself, does not own your Codex conversations, and should not be treated as a backup or storage layer for Codex data. Use it at your own risk.

## Interface Preview

<p>
  <img src="public/screenshots/conversation-demo.png" width="420" alt="Codex Messenger conversation window">
  <img src="public/screenshots/roster-demo.png" width="210" alt="Codex Messenger contact list and demo mode">
</p>

## Quick Install

### Option 1: Windows installer

1. Open the [Releases](https://github.com/anisayari/codex-messenger/releases) page.
2. Download `Codex.Messenger.Setup.0.0.2.exe`.
3. Run the installer.
4. On first launch, confirm that Codex is detected or manually select the path to `codex`, `codex.cmd`, or `codex.exe`.

If Windows SmartScreen shows a warning, that is expected for an unsigned app. Continue only if the file comes from the official GitHub release.

If Codex Messenger is already installed, use the launcher or the Windows app entry to check for updates or uninstall the front client. Uninstalling Codex Messenger must not be used to delete Codex conversations, project files, or Codex CLI data.

### Option 2: portable build

Download `Codex.Messenger.0.0.2.exe` from the releases page and run it directly. No installer is required.

### Option 3: from source

Requirements:

- Node.js 20 or newer.
- npm.
- Codex CLI installed locally.

```powershell
git clone https://github.com/anisayari/codex-messenger.git
cd codex-messenger
npm install
npm run check:codex
npm run electron:start
```

## Useful Scripts

```powershell
# Verify that Codex CLI can be detected
npm run check:codex

# Build the Vite renderer
npm run build

# Start the Electron app
npm run electron:start

# Start Electron in development mode with Vite
npm run electron:dev

# Electron smoke test
npm run electron:smoke

# Build Windows installer and portable executable
npm run package:win
```

Two PowerShell launchers are also included:

```powershell
.\launch-codex-messenger.ps1
.\launch-web-preview.ps1
```

`launch-codex-messenger.ps1` opens a small Windows launcher. It can launch Codex Messenger, check the latest GitHub version, open the update page, or uninstall only the Codex Messenger front client. It leaves Codex conversations and project data untouched.

`launch-web-preview.ps1` starts Vite and opens the web preview. The full application is still Electron-only because Codex integration, filesystem access, camera capture, and conversation windows run through the main process.

## Updates

Codex Messenger checks for updates on startup:

- Codex Messenger front: compares the local app version with the version published in the GitHub repository.
- Codex app-server: checks the local `codex --version` output and compares it with the public `@openai/codex` npm package.

When an update is available, an `Update` button appears at the top of the main window. You can also open `File -> About Codex Messenger...` or `File -> Check for updates` to see the current version and run a manual check.

The app does not auto-install updates. The update buttons open the relevant release or npm page so you can choose what to install.

## Uninstall

Use Windows Apps settings, the original installer entry, or:

```powershell
.\launch-codex-messenger.ps1
```

Then click `Uninstall`.

The uninstaller is intended to remove only the Codex Messenger front client, shortcuts, and application files. It should not remove:

- Codex conversations.
- Codex CLI configuration or caches.
- Your project folders.
- Files outside the Codex Messenger install directory.

## Features

- Windows XP / MSN Messenger 7 inspired interface.
- One desktop window per Codex conversation.
- Connection to `codex app-server` from the Electron main process.
- No API keys exposed to the renderer.
- Codex response language selection: French by default, plus English, Spanish, and Japanese.
- Language definitions centralized in `shared/languages.js` so new languages can be added quickly.
- Codex contacts for the main agent, reviewer, designer, local projects, custom agents, and recent threads.
- Custom agents created from `Add a Contact`, with name, group, status, icon, color, and dedicated instructions.
- Demo mode from the `Help` menu, with isolated showcase agents, a showcase project, and seeded demo threads that do not list real Codex conversations.
- Messenger-style grouped contact list.
- Generated avatars for agents, projects, and recent conversations.
- Conversation windows focused on the selected contact.
- Project threads displayed as MSN-style tabs above the transcript, with drag reorder and delete controls.
- Streaming Codex responses without duplicate final messages.
- MSN sounds for new messages and Wizz/Nudge.
- Local MSN 7 sound pack: new message, new email, Wizz/Nudge, online presence, ring, phone, typing, and task complete.
- MSN Messenger 7.5.0322 assets extracted from the archived Microsoft installer: PNG, GIF, JPG, bitmaps, icons, UI resources, and integrity manifests.
- MSN emoticon pack extracted from the original 19 px strips, available from the smile button and rendered inline in messages.
- Extracted MSN CAB packages: 15 official winks, 4 dynamic backgrounds, and preserved MSN Search resources under `public/msn-assets/msn75/packages`.
- Winks can be sent from the Activities panel; Codex can also trigger them with `[wink:...]` markers.
- Wizz when Codex finishes or when an unread message stays unattended for too long.
- Send files and images to Codex.
- Local camera snapshot before sending.
- Voice clip recording.
- Profile picture, status, and personal message.
- Local mini-games: Tic-Tac-Toe, Memory, and Wizz Reflex.
- Mini-games styled with extracted MSN assets.
- Windows packaging with NSIS installer and portable executable.

## Codex Detection

Codex Messenger looks for Codex in this order:

1. The path entered on the login screen.
2. The `CODEX_MESSENGER_CODEX_PATH` environment variable.
3. The system `PATH` using `where codex` on Windows.

On Windows, if npm returns an extensionless shim such as `C:\Users\you\AppData\Roaming\npm\codex`, the app automatically checks `codex.cmd`, `codex.exe`, and `codex.bat`.

Manual PowerShell fallback:

```powershell
$env:CODEX_MESSENGER_CODEX_PATH="C:\Users\you\AppData\Roaming\npm\codex.cmd"
npm run electron:start
```

If detection fails inside the app:

1. Click `Browse`.
2. Select `codex`, `codex.cmd`, `codex.exe`, or an equivalent binary.
3. Click `Test`.
4. Connect again.

## Configuration

Useful environment variables:

```powershell
# Manual path to Codex CLI
$env:CODEX_MESSENGER_CODEX_PATH="C:\path\to\codex.cmd"

# Default working directory for Codex
$env:CODEX_MESSENGER_WORKSPACE="C:\Users\you\Desktop\projects"

# Root scanned for local projects
$env:CODEX_MESSENGER_PROJECTS_ROOT="C:\Users\you\Desktop\projects"

# Delay before unread Wizz reminder, in milliseconds
$env:MSN_UNREAD_WIZZ_MS="300000"
```

## Local Data

In development, temporary uploads are stored inside the project folder.

In packaged builds, settings, uploads, and profile pictures are stored in Electron's user data directory. This avoids writing inside `app.asar`.

Codex conversations remain managed by Codex and your local Codex setup. Codex Messenger reads and sends messages through `codex app-server`; it is not the source of truth for conversation storage.

## Windows Packaging

```powershell
npm install
npm run package:win
```

Generated files are written to `release/`:

- `Codex Messenger Setup 0.0.2.exe`: Windows installer.
- `Codex Messenger 0.0.2.exe`: portable build.
- `win-unpacked/`: unpacked folder for local testing.

The build is not signed. For broad public distribution, add Windows code signing.

## Integrity Checks

Before publishing or making release changes:

```powershell
npm run check:codex
npm run build
npm run electron:smoke
```

To verify a generated executable:

```powershell
& ".\release\win-unpacked\Codex Messenger.exe" --smoke-test
```

Windows smoke tests may print Electron logs such as `Gpu Cache Creation failed`. The smoke test is considered successful when the command exits with code `0`.

## Troubleshooting

### `codex` is not detected

Set `CODEX_MESSENGER_CODEX_PATH` or select the binary from the login screen.

### Double-clicking `index.html`

`index.html` is a Vite entry point and should not be opened directly through `file://`. Use:

```powershell
npm run dev
```

or:

```powershell
npm run electron:start
```

### SmartScreen blocks the installer

The app is unsigned. Verify that the executable comes from the official GitHub release, then choose `More info` and `Run anyway`.

## Service and Liability Notice

Codex Messenger is an experimental open-source front client for local Codex usage. It is provided "as is", without warranty of any kind.

By installing or using it, you understand that you are responsible for your own machine, projects, Codex configuration, credentials, generated output, and data backups. The project, its contributors, Anis AYARI, and Codex cannot be held responsible for damages, data loss, project corruption, security issues, downtime, costs, or any other consequence arising from installation, update, uninstall, or use of the software.

This project is not affiliated with Microsoft, MSN, Windows Live Messenger, or OpenAI. Names and visual references are used only to describe the intended retro interface style and Codex client behavior.

## License

MIT. See [LICENSE](LICENSE).
