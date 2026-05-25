// 数字人撮合服务 - Mock Server（仅 Web 端 / UI 演示用途）
//
// 与生产服务端的关键差异：
//   - 不接受 bot 心跳，不模拟 webhook，不接受 DELETE 调试，没有真实 bot 接入。
//   - bot 状态完全由本服务端随机生成（per-botId 缓存 ROLL_TTL_MS），用于 UI 状态展示与切换演示。
//   - 即使返回可入房（IDLE → 抢占成功），房间里也永远只有 Web 端一个用户；
//     远端 bot 仅作为一个符号化的 userId（`bot_mock`），不会真的入房。
//
// 入房凭据：
//   - 如配置 MOCK_SDK_APP_ID + MOCK_SDK_SECRET_KEY，会签发真正可入房的 userSig。
//   - 未配置，则不会出现「可入房」分支，bot 在每次随机里只会落到 OFFLINE / BUSY。
//
// 启动：
//   npm run mock                                # 监听 :8787
//   PORT=4000 npm run mock                      # 自定义端口
//
// 端点（保留与 docs §3 兼容的子集）：
//   GET    /rtc/bots/:botUserId              — 读取 bot 状态（200 / 7410）
//   POST   /rtc/bots/:botUserId/connect      — Web 端抢占 / 同名重连（200 / 7409 / 7410）
//   GET    /healthz                          — 健康检查

import { createServer } from 'node:http';
import { genTestUserSig } from './userSig.mjs';

const PORT = Number(process.env.PORT) || 8787;
const ROLL_TTL_MS = Number(process.env.ROLL_TTL_MS) || 30_000;
const RECONNECT_WINDOW_MS = Number(process.env.RECONNECT_WINDOW_MS) || 30_000;
const RECONNECT_GUARD_MS = 10_000; // 距 deadline < 10s 拒绝同名重连
const USERSIG_TTL_SEC = Number(process.env.USERSIG_TTL_SEC) || 3_600;
const JANITOR_INTERVAL_MS = 10_000;

// 落到「可入房 / 不可入房」分支的随机权重（介于 0~1，IDLE/OFFLINE 命中概率）
const JOINABLE_BIAS = clamp01(envFloat('JOINABLE_BIAS', 0.6));
const OFFLINE_BIAS = clamp01(envFloat('OFFLINE_BIAS', 0.5));

const SDK_APP_ID = Number(process.env.MOCK_SDK_APP_ID) || 0;
const SDK_SECRET_KEY = process.env.MOCK_SDK_SECRET_KEY || '';
const SIG_ENABLED = SDK_APP_ID > 0 && SDK_SECRET_KEY.length > 0;

const MOCK_BOT_REMOTE_USERID = 'bot_mock'; // 房间内符号化的远端 bot 标识，仅供日志/参考

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function signUserSig(userId) {
  if (!SIG_ENABLED) {
    throw new Error('signUserSig called without SDK credentials configured');
  }
  return genTestUserSig({
    sdkAppId: SDK_APP_ID,
    secretKey: SDK_SECRET_KEY,
    userId,
    expireSec: USERSIG_TTL_SEC,
  });
}

// botUserId → { status: 'IDLE'|'BUSY'|'OFFLINE', rolledAt }
const rolls = new Map();

// botUserId → { roomId, userId, userSig, userName, expiresAt, deadline }
const rooms = new Map();

// ---------- helpers ----------

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify(body));
};

const ok = (res, result) => json(res, 200, { success: true, result });

const fail = (res, code, message) => {
  // HTTP status = code 末三位（7404 → 404, 7409 → 409, ...）；7000 → 500
  const httpStatus = code === 7000 ? 500 : Number(String(code).slice(1));
  json(res, httpStatus, { success: false, errors: [{ code, message }] });
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });

const hex = (len = 8) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const BOT_ID_RE = /^bot_[a-zA-Z0-9_]{1,32}$/;

function rollStatus(botUserId) {
  // 房间存在 → 直接报 BUSY（一致性：在房间未释放前不切走）
  const room = rooms.get(botUserId);
  if (room && Date.now() < room.deadline) {
    return 'BUSY';
  }
  // 房间过期，顺手清掉
  if (room) rooms.delete(botUserId);

  const cached = rolls.get(botUserId);
  if (cached && Date.now() - cached.rolledAt < ROLL_TTL_MS) {
    return cached.status;
  }

  let status;
  if (SIG_ENABLED) {
    // 可入房分支：IDLE / BUSY
    status = Math.random() < JOINABLE_BIAS ? 'IDLE' : 'BUSY';
  } else {
    // 不可入房分支：OFFLINE / BUSY
    status = Math.random() < OFFLINE_BIAS ? 'OFFLINE' : 'BUSY';
  }
  rolls.set(botUserId, { status, rolledAt: Date.now() });
  console.log(`[roll] ${botUserId} -> ${status}`);
  return status;
}

// ---------- janitor ----------

setInterval(() => {
  const now = Date.now();
  for (const [botUserId, room] of rooms) {
    if (now >= room.deadline) {
      rooms.delete(botUserId);
      console.log(`[janitor] room expired -> released ${botUserId}`);
    }
  }
  for (const [botUserId, roll] of rolls) {
    if (now - roll.rolledAt > ROLL_TTL_MS * 4) {
      rolls.delete(botUserId);
    }
  }
}, JANITOR_INTERVAL_MS);

// ---------- handlers ----------

// GET /rtc/bots/:botUserId
function handleGetBot(res, botUserId) {
  if (!BOT_ID_RE.test(botUserId)) return fail(res, 7400, 'invalid botUserId');
  const status = rollStatus(botUserId);
  if (status === 'OFFLINE') {
    return fail(res, 7410, `Bot ${botUserId} is offline`);
  }
  return ok(res, {
    botUserId,
    status, // 'IDLE' | 'BUSY'
    lastHeartbeatAt: Date.now(),
  });
}

// POST /rtc/bots/:botUserId/connect
async function handleConnect(req, res, botUserId) {
  if (!BOT_ID_RE.test(botUserId)) return fail(res, 7400, 'invalid botUserId');
  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 7400, 'malformed JSON body');
  }

  const userName = (body.userName || '').trim();
  // eslint-disable-next-line no-control-regex -- intentionally reject control chars in usernames
  if (!userName || userName.length > 32 || /[\x00-\x1F\x7F]/.test(userName)) {
    return fail(res, 7400, 'userName must be 1-32 chars, no control chars');
  }

  // 1. 同名重连：当前 bot 已被本 userName 占用 → 返回同一房间（幂等）
  const existing = rooms.get(botUserId);
  if (existing && Date.now() < existing.deadline) {
    if (existing.userName !== userName) {
      return fail(res, 7409, 'Bot is currently in another call');
    }
    if (existing.deadline - Date.now() < RECONNECT_GUARD_MS) {
      return fail(res, 7409, 'Reconnect window too tight');
    }
    if (SIG_ENABLED) {
      existing.userSig = signUserSig(existing.userId);
      existing.expiresAt = Date.now() + USERSIG_TTL_SEC * 1000;
    }
    console.log(`[connect] same-name reconnect ${botUserId} room=${existing.roomId}`);
    return ok(res, {
      status: 'BUSY', // 同名重连按 docs §3.2 用 BUSY + reservationDeadline=null
      sdkAppId: SDK_APP_ID,
      roomId: existing.roomId,
      userId: existing.userId,
      userSig: existing.userSig,
      expiresAt: existing.expiresAt,
      reservationDeadline: null,
    });
  }

  // 2. 否则走随机：根据 roll 决定是否给入房凭据
  const status = rollStatus(botUserId);
  if (status === 'OFFLINE') return fail(res, 7410, `Bot ${botUserId} is offline`);
  if (status === 'BUSY') {
    // 无凭据模式：连 BUSY 都没法签房间 sig，回一个不含房间信息的 BUSY envelope
    // 让前端走「检测 roomId/userSig 缺失 → 提示机器人正忙」分支
    if (!SIG_ENABLED) {
      return ok(res, {
        status: 'BUSY',
        sdkAppId: 0,
        reservationDeadline: null,
      });
    }
    return fail(res, 7409, 'Bot is currently busy');
  }

  // status === 'IDLE'：抢占成功 → 签 sig、记房间
  if (!SIG_ENABLED) {
    // 保险丝：理论上无凭据时 rollStatus 不会返回 IDLE
    return fail(res, 7503, 'SDK credentials not configured on mock server');
  }

  const now = Date.now();
  const roomId = `room_${hex(8)}`;
  const userId = `user_${hex(8)}`;
  const userSig = signUserSig(userId);
  const deadline = now + RECONNECT_WINDOW_MS;
  const expiresAt = now + USERSIG_TTL_SEC * 1000;

  rooms.set(botUserId, { roomId, userId, userSig, userName, expiresAt, deadline });
  // 一旦抢占成功，roll 也固定为 BUSY，保持后续 getStatus 一致
  rolls.set(botUserId, { status: 'BUSY', rolledAt: now });

  console.log(
    `[connect] ${botUserId} RESERVED room=${roomId} user=${userId} userName=${userName}` +
      ` (remote bot=${MOCK_BOT_REMOTE_USERID}, never joins)`
  );

  return ok(res, {
    status: 'RESERVED',
    sdkAppId: SDK_APP_ID,
    roomId,
    userId,
    userSig,
    expiresAt,
    reservationDeadline: deadline,
  });
}

// ---------- router ----------

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  const url = new URL(req.url, 'http://x');

  try {
    let m;
    if (
      (m = url.pathname.match(/^\/rtc\/bots\/(bot_[a-zA-Z0-9_]+)\/connect$/)) &&
      req.method === 'POST'
    ) {
      return handleConnect(req, res, m[1]);
    }
    if ((m = url.pathname.match(/^\/rtc\/bots\/(bot_[a-zA-Z0-9_]+)$/)) && req.method === 'GET') {
      return handleGetBot(res, m[1]);
    }
    if (url.pathname === '/healthz') {
      return ok(res, {
        uptime: process.uptime(),
        sigEnabled: SIG_ENABLED,
        rolls: rolls.size,
        rooms: rooms.size,
      });
    }
    fail(res, 7404, `${req.method} ${url.pathname} not found`);
  } catch (e) {
    console.error('[error]', e);
    fail(res, 7000, e.message || 'internal error');
  }
});

server.listen(PORT, () => {
  console.log(`Mock matchmaker (UI demo mode) listening on http://localhost:${PORT}`);
  if (SIG_ENABLED) {
    console.log(`UserSig signing: ENABLED (sdkAppId=${SDK_APP_ID})  →  rolls IDLE / BUSY`);
    console.log(`  · IDLE bias: ${JOINABLE_BIAS}  · room hold: ${RECONNECT_WINDOW_MS}ms`);
    console.log('  · joinable, but no real bot will enter the room (远端 bot 仅符号占位)');
  } else {
    console.log('UserSig signing: DISABLED  →  rolls OFFLINE / BUSY (never joinable)');
    console.log(`  · OFFLINE bias: ${OFFLINE_BIAS}`);
    console.log('  · set MOCK_SDK_APP_ID + MOCK_SDK_SECRET_KEY to unlock joinable demo');
  }
  console.log('Endpoints:');
  console.log('  GET    /rtc/bots/:botUserId');
  console.log('  POST   /rtc/bots/:botUserId/connect');
  console.log('  GET    /healthz');
});
