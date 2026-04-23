# codexmessenger.net

Static showcase site for Codex Messenger.

This directory is a standalone sub-project inside the main `Codex-messenger` repository. It is intentionally separate from the Electron/Vite app entrypoint at the repository root.

## Files

- `index.html`: static retro landing page.
- `assets/site.js`: small local interaction layer for XP-style button feedback.
- `assets/`: PNG images used by the landing page.
- `downloads/CodexMessenger.exe.sha256`: checksum for the installer currently deployed on the VPS.
- `downloads/.gitkeep`: keeps the download directory in Git.
- `nginx.codexmessenger.net.conf`: nginx vhost used on the VPS.

The Windows installer itself is not committed to Git. Copy it to `/var/www/codexmessenger.net/downloads/CodexMessenger.exe` on the VPS during release deployment.

## Release checklist

1. Build the Windows installer locally.
2. Upload `CodexMessenger.exe` to `/var/www/codexmessenger.net/downloads/`.
3. Update `/var/www/codexmessenger.net/downloads/CodexMessenger.exe.sha256`.
4. Copy the new checksum back into this folder.
5. Bump the download cache parameter in `index.html`, for example `?v=0.1.5`.
6. Reload nginx after changing the vhost config.

## Manual VPS deploy

Run from the repository root on the VPS or from a synced checkout:

```bash
sudo mkdir -p /var/www/codexmessenger.net
sudo rsync -av --delete \
  --exclude 'README-deploy.md' \
  --exclude 'nginx.codexmessenger.net.conf' \
  --exclude 'downloads/CodexMessenger.exe' \
  ./codexmessenger.net/ /var/www/codexmessenger.net/
sudo cp ./codexmessenger.net/nginx.codexmessenger.net.conf /etc/nginx/sites-available/codexmessenger.net
sudo ln -sf /etc/nginx/sites-available/codexmessenger.net /etc/nginx/sites-enabled/codexmessenger.net
sudo nginx -t
sudo systemctl reload nginx
```

## Current production setup

- Web root: `/var/www/codexmessenger.net`
- Domain: `codexmessenger.net`
- Canonical redirect: `www.codexmessenger.net` to `codexmessenger.net`
- TLS: Let's Encrypt, renewed by Certbot
- CDN/DNS: Cloudflare proxy
- Security posture: static site, strict CSP, only same-origin JavaScript
