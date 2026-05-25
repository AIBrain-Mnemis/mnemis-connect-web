# RTC client integration spec

Canonical contract between the Web client (this repo), the Bot client (out-of-scope, e.g. Electron), and the matchmaker backend (out-of-scope; a reference mock lives in `tools/mock-server.mjs`).

The TypeScript shapes in `src/api/types.ts` and the mock server implementation are the source of truth — this document is a reading guide.

## 1. Bot ID

A bot is addressed by `botUserId`, format `^bot_[a-zA-Z0-9_]{1,32}$`.

## 2. Response envelope

All endpoints return JSON wrapped in:

```jsonc
// Success
{ "success": true, "result": { /* endpoint-specific */ } }

// Failure
{ "success": false, "errors": [{ "code": 7409, "message": "BOT_BUSY" }] }
```

The numeric `code` and the HTTP status map 1:1 by the trailing 3 digits (`7404` → HTTP 404, `7409` → 409, `7000` → 500).

## 3. Endpoints used by the Web client

### 3.1 GET /rtc/bots/:botUserId — read bot status

Success result:

```ts
interface BotStatusInfo {
  botUserId: string;
  status: 'IDLE' | 'RESERVED' | 'BUSY';
  lastHeartbeatAt: number; // unix ms
}
```

Errors: `7400` (bad id), `7410` (offline / expired).

### 3.2 POST /rtc/bots/:botUserId/connect — acquire or rejoin

Request:

```json
{ "userName": "alice" }
```

Same `userName` is idempotent — calling again returns the same room (used for refresh / reconnect). A different `userName` while the room is held → `7409`.

Success result:

```ts
interface ConnectResult {
  status: 'RESERVED' | 'BUSY';
  sdkAppId: number;
  // Present when the server can issue room credentials.
  // For BUSY without credentials (e.g. mock without SDK keys), these fields are absent
  // and the client should surface "bot is busy" instead of joining a room.
  roomId?: string;
  userId?: string;
  userSig?: string;
  expiresAt?: number;
  // null on same-name reconnect (BUSY); a unix-ms timestamp on first acquisition (RESERVED).
  reservationDeadline: number | null;
}
```

Errors: `7400` (bad input), `7404` (bot not registered), `7409` (bot busy / same-name reconnect window too tight), `7410` (offline), `7503` (backend missing SDK secret).

## 4. Lifecycle

- Web `POST /connect` → receives credentials → joins TRTC room.
- Bot heartbeats independently; TRTC webhooks tell the backend when a side leaves.
- Web exits the call by calling `trtc.exitRoom()` locally — there is **no** client-callable hangup endpoint. The backend cron + TRTC webhooks reclaim the bot ≤ 1 min after the user leaves.

## 5. Error codes

| Code   | HTTP | Meaning                                  |
| ------ | ---- | ---------------------------------------- |
| `7400` | 400  | Bad input                                |
| `7404` | 404  | Bot not registered / removed             |
| `7409` | 409  | BOT_BUSY (or reconnect window too tight) |
| `7410` | 410  | BOT_OFFLINE / expired                    |
| `7429` | 429  | Upstream rate-limited                    |
| `7000` | 500  | Internal error                           |
| `7502` | 502  | TRTC REST unavailable                    |
| `7503` | 503  | Backend missing SDK credentials          |
