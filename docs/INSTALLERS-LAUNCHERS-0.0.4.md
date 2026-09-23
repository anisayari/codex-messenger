# Installer and launcher validation for 0.0.4

This release corrects installation, startup, update state and uninstall behavior. The native release workflow must pass on Windows x64, macOS Apple Silicon and macOS Intel before publication.

| User-visible behavior | Validation and evidence |
| --- | --- |
| Open an installed app without requiring Node or an interactive Codex login | Real PowerShell/Bash launcher regression tests with controlled installations and runtime paths |
| Start source mode from a checkout with spaces in its path | Launcher dependency/runtime tests and native development runner smoke from a different working directory |
| Open the web preview after its own server starts, and stop it cleanly | Busy-port regression and native HTTP/exit/port-release proof |
| Windows installer works in a custom installation directory | Execute the actual NSIS installer, inspect registration and shortcut, launch the installed app |
| Windows installation refuses to replace an application that is still open | Start the actual installed app in a private profile; require silent setup refusal with exit 42 while its PID, complete installed payload and registration remain unchanged |
| Windows uninstallation protects unrelated files and profiles | Refused uninstall with a foreign sentinel; successful uninstall after removing only that test sentinel; project/Codex/profile sentinels preserved |
| Legacy shared install directories are protected before the old uninstaller runs | Execute the new installer against an isolated legacy registry fixture and check refusal/preservation |
| Portable Windows executable starts its actual bundled app in a separate extraction directory per launch | Execute the actual wrapper with private temporary paths containing spaces; require its renderer under the launch-specific NSIS plugin directory, correct version, packaged renderer readiness, clean exit and an empty wrapper TEMP afterward |
| macOS DMG and ZIP contain a working app of the requested architecture | Read-only mount/copy or extract each actual artifact; inspect bundle identity and launch each extracted app |
| A manual unsigned update releases the UI and explains the next action | Updater and hook regressions; signature checks remain required for automatic replacement |
| Website downloads match the release and open in English | Production browser checks, exact release links and public installer HEAD responses |

Each installer is hashed before and after execution. Its app.asar must match the unpacked app tested on the same native host. Every packaged app observation requires version, architecture, rendered DOM, preload bootstrap, sandbox, isolated renderer and profile, zero runtime errors, and a normal exit. These observations do not demonstrate paid model calls, account login, physical microphone/camera behavior or signed replacement.

The installer checks running applications through the bundled native nsProcess plugin. Only its documented `603` result confirms absence; an enumeration error stops installation. A running copy must be closed manually before Retry, including another installation with the same executable name. Silent installation waits at most two seconds for an exit already in progress, then refuses with 42. This removes the installer’s unbounded PowerShell startup and avoids terminating unrelated applications.

Windows ICO assets are packaged beside app.asar, with their original bytes preserved. The native portable diagnostic identified the leftover file as the exact 124,195-byte application icon (SHA256 `b9dfceed9043310fc8485320627e8023faf067eba6870f60dfcec693bd30c571`). Electron 41.10.7 [loads archived Windows icons through CopyFileOut](https://github.com/electron/electron/blob/v41.10.7/shell/common/api/electron_api_native_image.cc), whose [Windows temporary-file cleanup waits for a reboot](https://github.com/electron/electron/blob/v41.10.7/shell/common/asar/scoped_temporary_file.cc). [Unpacked archive entries use their real payload path](https://github.com/electron/electron/blob/v41.10.7/shell/common/asar/archive.cc). A real electron-builder archive regression verifies both ICO entries are unpacked and unchanged while PNG and JavaScript remain archived; the native portable check still requires its fresh TEMP to be empty after exit.

The complete installer fixture has a ten-minute abort budget. Windows registry probes measured 23–29 seconds each on the native runner, and the live-app refusal case adds two such probes. Individual command limits remain fixed: 60 seconds for setup and PowerShell, 30 seconds for uninstallation or refused replacement, and 15 seconds for the additional running app to become ready. Its readiness log starts at the pre-launch end-of-file offset, and cleanup targets only the test's spawned PID and descendants.

Publication evidence will be added after the native workflow and public deployment succeed. Signing credentials are not supplied to the unsigned release workflow.
