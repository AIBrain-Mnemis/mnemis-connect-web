# Deployment

This repo ships two GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`) — runs on every push & PR: prettier, lint, typecheck, tests.
- **Deploy** (`.github/workflows/deploy.yml`) — runs after CI succeeds on `main` (or via manual dispatch). Builds the SPA and `rsync`s `dist/` to a local path on the deploy host.

Both workflows target `runs-on: [self-hosted, linux]`, i.e. a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners) installed on the same host you publish to — no SSH hop, no SSH secrets required. If you prefer GitHub-hosted runners + SSH-based deploys, swap the `rsync` step accordingly.

## Repository variables you must set

In **Settings → Secrets and variables → Actions → Variables**:

| Variable            | Required | Example                     | Purpose                                           |
| ------------------- | -------- | --------------------------- | ------------------------------------------------- |
| `VITE_API_BASE_URL` | optional | `https://api.example.com`   | Backend matchmaker URL baked into the bundle.     |
| `DEPLOY_TARGET_DIR` | yes      | `/var/www/example.com/dist` | Absolute path on the runner host to publish into. |

If `VITE_API_BASE_URL` is unset, the bundle uses relative `/rtc` paths and your web server must reverse-proxy `/rtc/*` to the backend.

## Trigger flow

- Push to `main` → **CI** runs.
- **CI** succeeds → **Deploy** runs (build + publish).
- **CI** fails → **Deploy** is skipped.
- Manual force-deploy: Actions → **Deploy** → **Run workflow** (bypasses CI gate).

## One-time runner setup on the deploy host

Run as a regular user that has write access to the target directory (or that can `sudo` without password). Commands below assume Ubuntu 22+.

```bash
# 1. Prereqs
sudo apt update
sudo apt install -y curl git rsync
# Node 24 (matches the workflow's actions/setup-node version)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Register the runner (token from: repo → Settings → Actions → Runners → New self-hosted runner)
mkdir -p ~/actions-runner && cd ~/actions-runner
# Replace <VERSION> with the latest from https://github.com/actions/runner/releases
curl -O -L https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-linux-x64-<VERSION>.tar.gz
tar xzf actions-runner-linux-x64-<VERSION>.tar.gz

./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> \
  --labels linux --name <runner-name> --unattended

# 3. Install as a service so it survives reboots
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

The `linux` label is added automatically by the Linux installer; `self-hosted` is always present.

## Permissions on the web root

The runner user needs write access to `$DEPLOY_TARGET_DIR`. Easiest:

```bash
sudo mkdir -p /var/www/example.com/dist
sudo chown -R "$USER":"$USER" /var/www/example.com
```

If you keep the directory owned by `root` / `www-data`, grant the runner user passwordless sudo for `rsync` only and prefix the rsync command with `sudo`.

## Reverse proxy

Since the SPA uses `BrowserRouter`, the web server needs a history fallback:

```nginx
server {
  server_name example.com;
  root /var/www/example.com/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # Only needed if VITE_API_BASE_URL is left unset (same-origin /rtc):
  # location /rtc/ {
  #   proxy_pass https://api.example.com/rtc/;
  #   proxy_set_header Host api.example.com;
  # }
}
```
