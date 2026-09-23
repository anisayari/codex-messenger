# Installer and launcher validation for 0.0.4

This release corrects installation, startup, update state and uninstall behavior. The native release workflow must pass on Windows x64, macOS Apple Silicon and macOS Intel before publication.

| User-visible behavior | Validation and evidence |
| --- | --- |
| Open an installed app without requiring Node or an interactive Codex login | Real PowerShell/Bash launcher regression tests with controlled installations and runtime paths |
| Start source mode from a checkout with spaces in its path | Launcher dependency/runtime tests and native development runner smoke from a different working directory |
| Open the web preview after its own server starts, and stop it cleanly | Busy-port regression and native HTTP/exit/port-release proof |
| Windows installer works in a custom installation directory | Execute the actual NSIS installer, inspect registration and shortcut, launch the installed app |
| Windows uninstallation protects unrelated files and profiles | Refused uninstall with a foreign sentinel; successful uninstall after removing only that test sentinel; project/Codex/profile sentinels preserved |
| Legacy shared install directories are protected before the old uninstaller runs | Execute the new installer against an isolated legacy registry fixture and check refusal/preservation |
| Portable Windows executable starts its actual bundled app | Execute the actual wrapper with private temporary paths containing spaces; inspect version, packaged renderer readiness and clean exit |
| macOS DMG and ZIP contain a working app of the requested architecture | Read-only mount/copy or extract each actual artifact; inspect bundle identity and launch each extracted app |
| A manual unsigned update releases the UI and explains the next action | Updater and hook regressions; signature checks remain required for automatic replacement |
| Website downloads match the release and open in English | Production browser checks, exact release links and public installer HEAD responses |

Each installer is hashed before and after execution. Its app.asar must match the unpacked app tested on the same native host. Every packaged app observation requires version, architecture, rendered DOM, preload bootstrap, sandbox, isolated renderer and profile, zero runtime errors, and a normal exit. These observations do not demonstrate paid model calls, account login, physical microphone/camera behavior or signed replacement.

Publication evidence will be added after the native workflow and public deployment succeed. Signing credentials are not supplied to the unsigned release workflow.
