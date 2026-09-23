# codexmessenger.net

Static showcase site for Codex Messenger.

This directory is a standalone sub-project inside the main `Codex-messenger` repository. It is intentionally separate from the Electron/Vite app entrypoint at the repository root.

## Files

- `index.html`: static retro landing page.
- `assets/site.js`: bilingual copy, explicit URL language selection, keyboard-safe download chooser and XP-style button feedback.
- `assets/`: original retro branding and interface previews. The conversation screenshot is a verified production renderer with sample messages; the roster is an isolated demo.
- `downloads/.gitkeep`: keeps the download directory in Git.
- `nginx.codexmessenger.net.conf`: nginx vhost used on the VPS.

The Windows and macOS installers are not committed to Git and are not mirrored on the VPS. The download buttons open the official GitHub release page, and old `/downloads/...` URLs are redirected there by nginx.

## Language and release copy

An arrival without a valid explicit language query is always English, including browsers with a French locale or an old saved French preference. French is available at `?lang=fr`; the selector updates the URL and browser Back/Forward restores the language. No stored preference overrides the landing default.

The source currently describes Messenger `v0.0.4`, requiring Codex `0.156.1`. The platform choices lead to the official GitHub release page for Apple Silicon, Intel macOS and Windows x64 installers. The final publication and assets are verified by the release workflow; this directory contains no installers. Keep visible version labels aligned with the release being published.

Feature copy is based on `docs/VALIDATION.md` and the migration matrix, with voice access and microphone permissions stated explicitly. It makes no promise that every provider feature, closed MSN service or private desktop service is available.

## GitHub Actions deployment

Workflow: `.github/workflows/deploy-codexmessenger-net.yml`

Triggers:

- push to `main` when `codexmessenger.net/**` or the workflow changes
- GitHub release `published` or `edited`
- manual `workflow_dispatch`

Release behavior:

- resolves the event release tag for a release event, or the latest published release for pushes/manual runs
- patches official release-page URLs in the static HTML; visible version labels are kept in sync in source
- deploys only the static showcase site, not the Electron app

Required repository secrets:

- `CODEXMESSENGER_DEPLOY_HOST`: VPS host or IP
- `CODEXMESSENGER_DEPLOY_PORT`: SSH port
- `CODEXMESSENGER_DEPLOY_USER`: SSH user
- `CODEXMESSENGER_DEPLOY_SSH_KEY`: private SSH deploy key
- `CODEXMESSENGER_DEPLOY_KNOWN_HOSTS`: pinned SSH known_hosts entry
- `CODEXMESSENGER_DEPLOY_PATH`: web root, currently `/var/www/codexmessenger.net`

## Release checklist

1. Build the Windows and macOS installers.
2. Publish a GitHub release with the Windows `.exe` asset and macOS `.dmg` asset.
3. Wait for the `Deploy codexmessenger.net` workflow to finish.
4. Click `DOWNLOAD` on the website and verify it opens the GitHub release page.

## Manual VPS deploy

Run from the repository root on the VPS or from a synced checkout:

```bash
sudo mkdir -p /var/www/codexmessenger.net
sudo rsync -av --delete \
  --exclude 'README-deploy.md' \
  --exclude 'nginx.codexmessenger.net.conf' \
  ./codexmessenger.net/ /var/www/codexmessenger.net/
sudo cp ./codexmessenger.net/nginx.codexmessenger.net.conf /etc/nginx/sites-available/codexmessenger.net
sudo ln -sf /etc/nginx/sites-available/codexmessenger.net /etc/nginx/sites-enabled/codexmessenger.net
sudo nginx -t
sudo systemctl reload nginx
```

## Expected deployment configuration

- Web root: `/var/www/codexmessenger.net`
- Domain: `codexmessenger.net`
- Canonical redirect: `www.codexmessenger.net` to `codexmessenger.net`
- TLS: Let's Encrypt, renewed by Certbot
- CDN/DNS: Cloudflare proxy
- Security posture: static site, strict CSP, only same-origin JavaScript
