# CodexMessenger website QA — v0.0.3

The updated static website passes real-browser checks. English is the default on arrival; explicit French remains available through `?lang=fr` and the language selector. This report covers the local frozen source, not deployment.

## Environment

- Date: 2026-09-23.
- Local URL: `http://127.0.0.1:49962/`.
- Google Chrome 153.0.8010.50 in an isolated headless profile, bundled Playwright 1.62.1.
- Browser plugin unavailable; regular Playwright used.
- Local server used the nginx CSP except `upgrade-insecure-requests`, omitted for localhost HTTP.

## Checks

- **PASS — Page identity and rendering:** Expected CodexMessenger title, meaningful retro page, no blank/error/overlay page.
- **PASS — English default despite French browser and stale storage:** fr-FR context and codexMessengerLang=fr still render English at arrival without a supported explicit language query.
- **PASS — FR and EN selectors:** Visible text, active aria-current, document lang and query URL change together without reload.
- **PASS — History and explicit URLs:** Back restores French, reload preserves explicit French, Forward restores English, direct ?lang=fr is respected, unsupported ?lang=unknown falls back to English.
- **PASS — Modal opening and focus:** Keyboard Enter opens from desktop trigger; close button receives focus; background content is inert.
- **PASS — Modal keyboard loop and dismissal:** Shift+Tab from close reaches final Windows card; Tab returns to close; Escape closes and restores opener focus; modal reopens and backdrop click dismisses.
- **PASS — Three platform links:** Apple Silicon arm64, Intel x64 and Windows x64 are visible. All point to official GitHub releases/latest and use target=_blank with noopener noreferrer.
- **PASS — Mobile English and French:** French locale plus stale storage arrives in English at 390x844; explicit French selector updates URL and copy; mobile modal opens and Escape closes.
- **PASS — Responsive bounds:** Document scrollWidth equals viewport width at 1440, 1024, 390 and 320 px; French mobile primary CTA has no internal horizontal overflow at 320 px. Three cards fit 320x568 modal.
- **PASS — Media loading and page errors:** All inspected img elements loaded with naturalWidth>0; tracked desktop and mobile pages recorded zero JS exceptions, console errors and local HTTP errors/404s.
- **PASS — Visual review:** Inspected final English desktop, French mobile and mobile three-platform chooser; typography, primary CTA, captions and cards are legible. Retained original retro visual identity.
- **PASS — Source synchronization:** Four modified site files copied atomically and compared byte for byte in original and resident publication checkout; six durable screenshots copied to both.

## Scope and limits

- Local website QA does not prove deployed nginx headers, TLS or production content; root performs deployment verification.
- External social pages were preserved as existing HTTPS destinations; their uptime was not tested.
- GitHub releases/latest was readable and resolved v0.0.2.9 at this prepublication check. Release v0.0.3 installers are a pending root publication step, not a website QA claim.
- Codex 0.156.1 primary release exists. App feature wording is based on repository validation; live voice still depends on account/server availability and microphone permissions.

App claims follow [repository validation](/Users/anisayari/Desktop/01_Projects/codex-messenger/docs/VALIDATION.md). [Codex 0.156.1](https://github.com/openai/codex/releases/tag/rust-v0.156.1) and the [official download destination](https://github.com/anisayari/codex-messenger/releases/latest) were read during verification. The site states voice access and microphone requirements rather than promising universal availability.

## Evidence

- Exact source manifest: `validation/site-source-manifest-0.0.3.json`.
- Exact screenshot manifest: `validation/site-screenshots-manifest-0.0.3.json`.
- Structured report: `validation/site-browser-qa-0.0.3.json`.
- Durable screenshots, present in original and publication checkout:

- `docs/assets/newsite0.0.3/desktop-en.png`
- `docs/assets/newsite0.0.3/desktop-fr.png`
- `docs/assets/newsite0.0.3/mobile-en.png`
- `docs/assets/newsite0.0.3/mobile-fr.png`
- `docs/assets/newsite0.0.3/download-desktop-en.png`
- `docs/assets/newsite0.0.3/download-mobile-en.png`
