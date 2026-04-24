# Security Policy

## Supported Versions

Security fixes are handled on the latest published release and the `main` branch.

Codex Messenger is an Electron front-end for the local `codex app-server`. It does not replace Codex, does not own Codex conversation storage, and should not be treated as a credential or backup store.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory on this repository when available, or by contacting the maintainer directly through the public GitHub profile.

Include:

- A clear description of the issue.
- Reproduction steps.
- The affected platform and app version.
- Whether the issue involves installer/update integrity, local file access, `codex app-server`, IPC exposure, or dependency supply chain.

Please do not publish exploit details before a fix or mitigation is available.

## Security Expectations

- The renderer must not receive API keys or raw Codex credentials.
- Electron IPC channels should stay allowlisted and narrowly scoped.
- Downloaded updates must use official GitHub release assets and verify SHA-256 digests when GitHub exposes them.
- The app should only uninstall Codex Messenger files, not Codex conversations, Codex CLI data, or user project files.
- CI must run tests, release preflight checks, npm audit, CodeQL, and dependency review before changes are trusted.

## Current Distribution Caveat

Windows and unsigned macOS builds can trigger platform security warnings. Only install artifacts from the official GitHub release or codexmessenger.net download links that point to those release assets.
