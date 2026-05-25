# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

Web frontend for a 1:1 digital-human call service. Users open `/bot/:botUserId` (BrowserRouter), the page calls a matchmaker server (see `docs/rtc-client-integration.md`), receives a TRTC `userSig`, and joins the room. A separate Bot 端 (Electron, not in this repo) joins the same room. The server is also out-of-scope; the canonical client integration spec is `docs/rtc-client-integration.md`.

For local dev without a real server: `npm run mock` boots an in-memory Node mock at `:8787` that mirrors the API. The mock requires `MOCK_SDK_APP_ID` and `MOCK_SDK_SECRET_KEY` in `.env` or `.env.local` (auto-loaded via `node --env-file-if-exists`) and signs **real** sigs via `tools/userSig.mjs` — same algorithm as the browser lib, byte-equivalent after inflate. Web ↔ Bot 端 full call 联调 supported in this mode. Port 8787 chosen because Windows Hyper-V `excludedportrange` reserves 2918-3117 (3000/3001 fall inside) — avoid that range. Override with `PORT=4000 npm run mock` if 8787 is also taken.

**Default dev target is the local mock at `http://localhost:8787`.** With no `VITE_API_BASE_URL` set, the browser hits relative `/rtc/...` and Vite's dev proxy forwards to the mock (sidesteps CORS). Point at a remote backend by setting `VITE_API_BASE_URL=https://your-backend.example.com` in `.env.local`.

## Commands

- `npm run dev` — Vite dev server (proxies `/rtc` → `VITE_API_BASE_URL` or `http://localhost:8787`).
- `npm run mock` — start the local matchmaker mock at `:8787` (`tools/mock-server.mjs`); only needed when working offline.
- `npm run build` — `tsc && vite build`. The lint/typecheck gate; no separate test runner.
- `npm run preview` — preview the production build.

## Architecture

### Two state machines

**`useTRTC` (`src/hooks/useTRTC.ts`)** — owns the TRTC SDK lifecycle. Stateless about the matchmaker:

- One `TRTC.create()` per Hook instance, destroyed on unmount (cleanup runs `exitRoom` first to satisfy SDK's "leave before destroy" requirement).
- `enterRoom({ sdkAppId, userId, userSig, roomId })` — sig is **always injected from outside**; the hook does not generate sigs.
- Per-track state machines: `roomStatus` (`idle | entering | entered | exiting`), `micStatus` / `shareStatus` (`idle | starting | started | stopping`). The Web client only uses **microphone** and optional **screen share** — no camera.
- `bindEvents` registers `REMOTE_USER_ENTER` / `REMOTE_USER_EXIT` / `REMOTE_VIDEO_AVAILABLE` and exposes `remoteUserPresent: boolean` so upstream observes via React state (not its own SDK listener) — eliminates registration race vs. `enterRoom` and `off('*')` collateral damage.
- `exitRoom` does not gate on `micStatus === 'started'` — instead always tries `stopLocalAudio` / `stopScreenShare` and swallows "not started" errors. React state is async; gating on it caused the SDK's internal `_audioStarted` to drift out of sync.

**`useCallSession` (`src/hooks/useCallSession.ts`)** — owns the user call state machine consumed by `CallPage`:

```
loading → online → modalOpen → reserving → waiting → calling → ended → online
                  ↘ busy / offline                    ↘ ended
                                          ↘ timeout
```

Per the new server protocol (`docs/rtc-client-integration.md`):

- `RESERVED` and `BUSY` from the server both surface to the user as **busy** (the user shouldn't see internal bot state).
- `connect` returning `status='RESERVED'` (first acquisition) or `status='BUSY'` (same-name reconnect) both transition to `waiting`; the `BUSY` case has `reservationDeadline=null` so no countdown is shown.
- **No HTTP hangup**: `cleanupRef.current` only does `trtc.exitRoom()`. The server learns about call end via TRTC webhooks + cron (≤ 1 min). `beforeunload` only does `trtc.exitRoom()`; no beacon.
- **userName is persisted** to `sessionStorage[rtc:userName:${botUserId}]` so a network drop + retry uses the same name (different name → 7409). `NicknameModal` accepts `defaultValue` and CallPage pre-fills from sessionStorage.
- `inFlightRef` guards `startCall` against double-clicks and triggers `runCleanup` of any stale `cleanupRef` before re-entering the SDK.

### Error envelope (new contract)

The matchmaker uses `{success: true, result: ...}` / `{success: false, errors: [{code, message}]}`. `apiFetch` unwraps `result` on success; on failure throws `ApiError(httpStatus, code: number, message)`. Numeric codes are 7xxx (7400/7404/7409/7410/7503 etc.); HTTP status maps 1:1 to the trailing 3 digits (7404 → 404). `useCallSession.handleConnectError` switches on these numeric codes.

### TRTC remote subscription timing

`useTRTC` keeps the `setTimeout(0)` pattern for `REMOTE_VIDEO_AVAILABLE`: push the user into Zustand first so React renders the `<div id={elementId}>`, then the next macrotask `startRemoteVideo` finds the mounted node. The `elementId` is `${userId}_${streamType}` so a single user can have both `main` (camera) and `sub` (screen-share) views.

### Store (`src/store/index.ts`)

Slim Zustand: only `remoteUsers` and `logs`. Credentials live nowhere — they come from the matchmaker per call. Inside `useTRTC` callbacks, always read via `useAppStore.getState()` (not destructured) to avoid stale closures.

### API layer (`src/api/`)

- `client.ts` — `apiFetch<T>(path, init)` returns the unwrapped `result`, throws `ApiError(httpStatus, code: number, message)` on `success: false` or non-2xx.
- `bot.ts` — `botApi.{getStatus, connect}` mirroring `docs/rtc-client-integration.md` §3.1 / §3.2. **No** `hangup` / `hangupBeacon` — the new protocol has no client-callable hangup endpoint.
- `types.ts` — TS shapes for `BotStatusInfo`, `ConnectResult`, `ApiEnvelope`, `ApiErrorEnvelope`.

When the API contract changes, update `docs/rtc-client-integration.md` first; then `src/api/types.ts`; then consumers.

### Routing

`BrowserRouter` (not Hash). Routes: `/` (`LandingPage`), `/bot/:botId` (`CallPage`), `*` → redirect `/`. Production deploys need a history fallback (nginx/caddy) — Vite dev handles it. `botId` route param is the `botUserId` (form `^bot_[a-zA-Z0-9_]{1,32}$`).

### Build & path conventions

- `vite.config.mts: base: '/'` → absolute asset paths from site root. Required because the app uses `BrowserRouter` with deep routes like `/bot/:botId`; relative `./` would resolve to `/bot/assets/...` on a deep URL and trigger the SPA fallback (HTML), breaking MIME checks. If deploying under a subpath, change `base` to that subpath (e.g. `/app/`) instead of `./`.
- Path alias `@/*` → `src/*` declared in **both** `tsconfig.json` and `vite.config.ts`. Update both if it changes.
- `tsconfig.json` includes only `src` — no legacy/excluded paths.
- `dev` proxy: `/rtc` → `process.env.VITE_API_BASE_URL || http://localhost:8787`.
- StrictMode is **off** in `main.tsx` — TRTC SDK lifecycle is incompatible with double mount/cleanup (causes `API_CALL_ABORTED` 0x404d).

### i18n (`src/locales/`)

`en.json` and `zh-cn.json`. Top-level keys: `landing`, `call`.

## Things you'll wish you knew

- **Mock auto-promotes RESERVED → BUSY on bot heartbeat.** Real protocol does this via TRTC webhook 103; mock simulates by promoting when the bot's heartbeat sees an outstanding RESERVED assignment. Bot's _next_ heartbeat sees `status: BUSY, assignment: null` (matches real behavior). The mock has **no** webhook input and no cron, so a BUSY bot stays BUSY until the bot stops heartbeating — tear down the curl loop or use `DELETE /rtc/bots/:botUserId` (mock-only debug endpoint) to reset.
- **Same-name reconnect**: server treats same `userName` as the original user and returns the same room. Different `userName` → 7409. Web persists `userName` to `sessionStorage[rtc:userName:${botUserId}]` so refresh / retry works.
- **`reservationDeadline` is a hint**, not a hard limit. Server may reset it lazily on bot heartbeat. WaitingView countdown is informational; on timeout we transition to `timeout` state but the user can retry.
- The user's exit from `calling` is local-only (`trtc.exitRoom`); the server learns via TRTC webhooks + cron (≤ 1 min). For dev convenience the mock's `DELETE /rtc/bots/:botUserId` lets you wipe a bot's state immediately.

## Documents

- `docs/rtc-client-integration.md` — canonical client integration spec for both Web and Bot 端 (single source of truth for endpoints, payloads, error codes, lifecycle).
- `docs/deployment.md` — self-hosted runner deploy workflow.
