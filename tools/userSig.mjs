// 腾讯 TRTC UserSig 签发 (Node 版)
// 算法移植自浏览器版 lib-generate-test-usersig.min.js
// 与浏览器版**功能等价** —— 两者 inflate 后的内层 sig doc 字节级一致；
// 外层 base64 因 zlib 实现差异 (Node 自带 vs 浏览器 pako) 可能不同，
// 但 TRTC 服务端是 inflate 后比对 HMAC，所以两种产物都被接受。
//
// 用法 (作为模块):
//   import { genTestUserSig } from './userSig.mjs';
//   const sig = genTestUserSig({ sdkAppId: 1400000000, secretKey: 'xxx', userId: 'user_1', expireSec: 3600 });
//
// 用法 (CLI 调试):
//   node tools/userSig.mjs <sdkAppId> <secretKey> <userId> [expireSec]

import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * 生成 TRTC UserSig。
 * @param {{sdkAppId: number, secretKey: string, userId: string, expireSec?: number}} opts
 * @returns {string} userSig
 */
export function genTestUserSig({ sdkAppId, secretKey, userId, expireSec = 3600 }) {
  if (!sdkAppId || !secretKey || !userId) {
    throw new Error('genTestUserSig: sdkAppId / secretKey / userId are required');
  }
  const currTime = Math.floor(Date.now() / 1000);

  // 1. HMAC-SHA256 内容串拼接顺序与浏览器版一致：identifier → sdkappid → time → expire
  const contentToBeSigned =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expireSec}\n`;
  const hmacB64 = createHmac('sha256', secretKey).update(contentToBeSigned).digest('base64');

  // 2. 组装 sig doc — 字段顺序必须与浏览器版严格一致：ver -> identifier -> sdkappid -> time -> expire -> sig
  // (JSON.stringify 按插入顺序输出；顺序错了 deflate 字节就不一致)
  const sigDoc = {
    'TLS.ver': '2.0',
    'TLS.identifier': String(userId),
    'TLS.sdkappid': Number(sdkAppId),
    'TLS.time': Number(currTime),
    'TLS.expire': Number(expireSec),
    'TLS.sig': hmacB64,
  };

  // 3. JSON -> zlib deflate -> base64
  const json = JSON.stringify(sigDoc);
  const deflated = deflateSync(Buffer.from(json));
  const b64 = deflated.toString('base64');

  // 4. 腾讯私有 base64URL 变体：'+' -> '*', '/' -> '-', '=' -> '_'
  return b64.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

// CLI 入口
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/tools/userSig.mjs');
if (isMain) {
  const [, , sdkAppIdRaw, secretKey, userId, expireRaw] = process.argv;
  if (!sdkAppIdRaw || !secretKey || !userId) {
    console.error('Usage: node tools/userSig.mjs <sdkAppId> <secretKey> <userId> [expireSec]');
    process.exit(1);
  }
  const sig = genTestUserSig({
    sdkAppId: Number(sdkAppIdRaw),
    secretKey,
    userId,
    expireSec: expireRaw ? Number(expireRaw) : 3600,
  });
  process.stdout.write(sig + '\n');
}
