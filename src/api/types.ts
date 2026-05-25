// 与 docs/rtc-client-integration.md §3 字段一一对齐
export type BotStatus = 'IDLE' | 'RESERVED' | 'BUSY';

// GET /rtc/bots/:botUserId 成功 result
export interface BotStatusInfo {
  botUserId: string;
  status: BotStatus;
  lastHeartbeatAt: number;
}

// POST /rtc/bots/:botUserId/connect 成功 result
export interface ConnectResult {
  status: 'RESERVED' | 'BUSY';
  sdkAppId: number;
  // BUSY 且服务端无法签发凭据（例如 mock 未配置 SDKAPPID）时，下列字段缺失
  // → 客户端应据此判断为「机器人正忙」而非进入房间。
  roomId?: string;
  userId?: string;
  userSig?: string;
  expiresAt?: number;
  // BUSY 重连时为 null（已被 webhook 103 清空）
  reservationDeadline: number | null;
}

// 通用响应外形
export interface ApiEnvelope<T> {
  success: true;
  result: T;
}

export interface ApiErrorEnvelope {
  success: false;
  errors: Array<{ code: number; message: string }>;
}

// 已知错误码（HTTP 与 code 一对一映射）
export type ApiErrorCode =
  | 7400 // 入参格式错
  | 7404 // Bot 未注册或已被回收
  | 7409 // BOT_BUSY 或 reconnect 窗口太短
  | 7410 // BOT_OFFLINE
  | 7429 // 上游限流
  | 7000 // 内部错误
  | 7502 // TRTC REST 不可用
  | 7503; // 服务端 secret 缺失
