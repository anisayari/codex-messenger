# Production website QA — v0.0.3

The published [CodexMessenger site](https://codexmessenger.net/) passes 35 functional browser checks and two error/visual checks. English is the default, including with a French browser and stale French local storage. The final deployment [run 35878432705](https://github.com/anisayari/codex-messenger/actions/runs/35878432705) succeeded for commit `1b3542f731a81c8537830258df033668967717fa`; the installer guard, bundle and VPS deployment steps all ran successfully.

## Environment

- Checked: 2026-09-23T15:07:51.859Z.
- Isolated headless Google Chrome 153.0.8010.50, bundled Playwright 1.62.1. Browser plugin unavailable; regular Playwright used.
- French locale with `codexMessengerLang=fr` before arrival.
- Viewports: 1440×900, 390×844 and 320×568.

## Results

- Raw HTTPS HTML is English and the five mobile feature labels match the verified English copy before JavaScript. HTML SHA256: `b288a5fb6826ce1c8f00e26acb562a861237be4cbd33ca5dbbaf9ca49fc9ee70`.
- JavaScript is byte identical to the publication source: SHA256 `5539948a66c459a11c17a1f6275adae31b428ecf874563c8604ec00b5d427450`.
- EN/FR selectors update language and URL; Back, Forward, reload and direct French URLs work. Unsupported language queries fall back to English.
- Desktop and mobile choosers show macOS arm64, macOS x64 and Windows x64. All point to the [public v0.0.3 release](https://github.com/anisayari/codex-messenger/releases/tag/v0.0.3); a real card click opened it in a new tab. Public API metadata confirms the three platform installers are uploaded.
- Enter opens the chooser; initial focus, inert background, Tab/Shift+Tab loop, Escape, opener focus restoration, reopening, backdrop dismissal and mobile touch close work.
- Images load. No document horizontal overflow at the three tested widths. All three French cards fit the 320×568 viewport.
- The delivered CSP, HSTS and no-cache headers are present. No JavaScript exception, console error or HTTP error was recorded.

## Observation and limits

At 320 px, some social labels extend slightly outside their button borders, by up to about 7.4 px. They remain inside the viewport and separate from adjacent targets. This is a minor cosmetic observation; source was not changed during production verification.

These checks cover Chrome and emulated mobile/touch viewports. Physical devices, other engines and app feature execution were not tested here. Installer binaries were not downloaded again; [HTTP verification](site-production-http-0.0.3.json) and [six public installer checks](site-production-downloads-0.0.3.json) were produced separately by the parent. The [structured browser report](site-production-browser-0.0.3.json) contains all 37 checks and screenshot SHA256 hashes.

## Screenshots

- [production-desktop-en.png](../assets/newsite0.0.3/production/production-desktop-en.png)
- [production-desktop-fr.png](../assets/newsite0.0.3/production/production-desktop-fr.png)
- [production-download-desktop.png](../assets/newsite0.0.3/production/production-download-desktop.png)
- [production-download-mobile.png](../assets/newsite0.0.3/production/production-download-mobile.png)
- [production-mobile-en.png](../assets/newsite0.0.3/production/production-mobile-en.png)
- [production-mobile-fr.png](../assets/newsite0.0.3/production/production-mobile-fr.png)
- [production-mobile320-download-fr.png](../assets/newsite0.0.3/production/production-mobile320-download-fr.png)
