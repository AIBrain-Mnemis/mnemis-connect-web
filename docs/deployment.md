# Build & Deployment

This repo ships two GitHub Actions workflows, both running on GitHub-hosted runners (`ubuntu-latest`):

- **CI** (`.github/workflows/ci.yml`) — runs on every push & PR: prettier, lint, typecheck, tests.
- **Build** (`.github/workflows/build.yml`) — runs after CI succeeds on `main` (or via manual dispatch). Builds the SPA and uploads `dist/` as a downloadable zip artifact.

The Build workflow does **not** deploy. Download the zip from the Actions run page and publish it to your web host out-of-band.

## Build configuration

The Build workflow runs `npm run build` with no env overrides. In particular, `VITE_API_BASE_URL` is **not** set, so the bundle uses relative `/rtc` paths and your web server must reverse-proxy `/rtc/*` to the backend (see the nginx snippet below).

If you need a bundle that targets a specific backend URL, build it locally:

```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

## Trigger flow

- Push to `main` → **CI** runs.
- **CI** succeeds → **Build** runs (build + zip + upload artifact).
- **CI** fails → **Build** is skipped.
- Manual build: Actions → **Build** → **Run workflow** (bypasses CI gate).

## Downloading the artifact

1. Open the **Build** workflow run page on GitHub.
2. Scroll to the **Artifacts** section at the bottom of the summary.
3. Download `mnemis-connect-web-<sha>.zip` and extract it onto your web host.

Artifacts are retained per the repo's default retention policy (90 days unless overridden).

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

  # Required because the bundle is built without VITE_API_BASE_URL (same-origin /rtc):
  location /rtc/ {
    proxy_pass https://api.example.com/rtc/;
    proxy_set_header Host api.example.com;
  }
}
```
