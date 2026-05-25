# Mnemis Connect Web

Web client for a 1:1 digital-human call service. A user opens `/bot/:botUserId`, the page asks a matchmaker backend for a TRTC `userSig`, joins the room, and talks to a Bot client (e.g. an Electron app — out of scope for this repo) over real-time audio + optional screen share.

Read this in [中文](./README.zh.md).

## Features

- Bot ID landing page with input validation and `localStorage` recall of the last bot.
- Call session state machine (`useCallSession`): `online → reserving → waiting → calling → ended`, with `busy` / `offline` / `timeout` / `error` branches.
- TRTC SDK lifecycle hook (`useTRTC`): enter/exit room, microphone, screen share, remote video subscription, mute, and abort-safe cleanup.
- Same-name reconnect: `userName` persisted to `sessionStorage` so refresh / retry reuses the same room.
- i18n (English + 简体中文) with language auto-detection (URL `?lang=`, localStorage, browser locale).
- Local mock matchmaker (`tools/mock-server.mjs`) that signs real TRTC `userSig`s — Web ↔ Bot full call works without any backend deployed.
- Self-hosted GitHub Actions CI + Deploy (`rsync`-based, no SSH secrets).

## Tech stack

- React 18 + TypeScript, Vite 5
- React Router v6 (BrowserRouter)
- Zustand (slim state — only remote users + log sinks)
- Tailwind CSS 4 + shadcn-style component primitives (radix-ui)
- react-i18next
- `trtc-sdk-v5` for real-time media
- vitest for unit tests

## Quick start

```bash
# 1. install
npm install

# 2. set env (optional — defaults work for mock-only mode)
cp .env.example .env.local
#   Leave VITE_API_BASE_URL unset to use the local mock at http://localhost:8787
#   Or point it at your backend: VITE_API_BASE_URL=https://api.example.com

# 3. run (starts mock + Vite together)
npm run dev
```

Open <http://localhost:5800>, enter any suffix (becomes `bot_<suffix>`), and submit.

> The mock returns randomized bot statuses out of the box. To actually join a room you need TRTC SDK credentials — see _Mock with real userSig_ below.

## Scripts

| Command                 | What it does                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`           | Runs `dev:mock` + `dev:web` concurrently. Web points at the mock via `VITE_API_BASE_URL`. |
| `npm run dev:web`       | Vite dev server only (still proxies `/rtc` → `http://localhost:8787` by default).         |
| `npm run dev:mock`      | Mock matchmaker only (`tools/mock-server.mjs`) on `:8787`.                                |
| `npm run mock`          | Same as `dev:mock` — runs the mock standalone.                                            |
| `npm run build`         | `tsc && vite build`.                                                                      |
| `npm run preview`       | Preview the production build locally.                                                     |
| `npm run lint`          | ESLint (`--max-warnings=0`).                                                              |
| `npm run lint:fix`      | ESLint with `--fix`.                                                                      |
| `npm run format`        | Prettier write.                                                                           |
| `npm run format:check`  | Prettier check (used by CI).                                                              |
| `npm run typecheck`     | `tsc --noEmit`.                                                                           |
| `npm test`              | Vitest run.                                                                               |
| `npm run test:watch`    | Vitest watch mode.                                                                        |
| `npm run test:coverage` | Vitest with v8 coverage.                                                                  |

## Mock with real userSig

`tools/mock-server.mjs` can sign real `userSig`s so the Web client actually joins a TRTC room. Add to `.env.local`:

```bash
MOCK_SDK_APP_ID=1400000000          # your TRTC SDKAppID
MOCK_SDK_SECRET_KEY=<sdk-secret>    # your SDKSecretKey
```

When configured, the mock rolls between `IDLE` and `BUSY` (joinable). Without these vars it stays in `OFFLINE` / `BUSY` and `connect` never returns room credentials — useful for UI demos without TRTC.

A Bot client (any TRTC user) joining the same `roomId` with its own `userSig` completes the call. See [`docs/rtc-client-integration.md`](./docs/rtc-client-integration.md) for the contract.

## Pointing at a real backend

The Web client talks to a matchmaker server, not TRTC directly. The expected API surface is documented in [`docs/rtc-client-integration.md`](./docs/rtc-client-integration.md). The mock in `tools/mock-server.mjs` is a working reference implementation of that contract.

To switch from mock to a real backend:

```bash
# .env.local
VITE_API_BASE_URL=https://api.example.com
```

## Project layout

```
src/
├── main.tsx                  # entry
├── App.tsx                   # BrowserRouter shell
├── api/
│   ├── client.ts             # apiFetch + ApiError envelope handling
│   ├── bot.ts                # botApi.{getStatus, connect}
│   └── types.ts              # BotStatusInfo, ConnectResult, error codes
├── hooks/
│   ├── useTRTC.ts            # TRTC SDK lifecycle (room / mic / screen share)
│   └── useCallSession.ts     # call state machine + matchmaker glue
├── components/
│   ├── ErrorBoundary.tsx
│   └── ui/                   # shadcn-style primitives (button, input, avatar, …)
├── pages/
│   ├── LandingPage.tsx       # Bot ID input
│   └── CallPage/             # setup + in-call views
├── locales/                  # en / zh-cn JSON + i18next init
├── lib/                      # utils (cn helper, language detection)
└── store/                    # Zustand slice (remoteUsers + log sinks)
tools/
├── mock-server.mjs           # local matchmaker mock
└── userSig.mjs               # Node-side TRTC userSig signer
docs/
├── rtc-client-integration.md # backend API contract
└── deployment.md             # self-hosted runner CD setup
```

## Deployment

CI (`.github/workflows/ci.yml`) and Deploy (`.github/workflows/deploy.yml`) target a self-hosted Linux runner. See [`docs/deployment.md`](./docs/deployment.md) for runner setup and the two repo Variables you need to set (`VITE_API_BASE_URL`, `DEPLOY_TARGET_DIR`).

Production builds use `base: '/'` and `BrowserRouter`, so your web server must serve `index.html` as the SPA fallback (`try_files $uri $uri/ /index.html;` in nginx).

## Security note

`tools/userSig.mjs` is a **server-side** helper. The browser bundle does **not** ship SDK secrets — only the matchmaker holds the `SDKSecretKey` and signs `userSig`s on demand. Never commit `MOCK_SDK_SECRET_KEY` to a public repo.

## License

[MIT](./LICENSE) © 2026 AIBrain-Mnemis Teams
