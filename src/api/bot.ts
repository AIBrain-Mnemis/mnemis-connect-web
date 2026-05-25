import { apiFetch } from './client';
import type { BotStatusInfo, ConnectResult } from './types';

export const botApi = {
  /** GET /rtc/bots/:botUserId — 读取 Bot 状态 */
  getStatus: (botUserId: string) => apiFetch<BotStatusInfo>(`/rtc/bots/${botUserId}`),

  /**
   * POST /rtc/bots/:botUserId/connect — 抢占或同名重连
   * 同 userName 重复调用是幂等的，可用作重连。
   * 不同 userName 会被识别为另一个用户，返回 7409。
   */
  connect: (botUserId: string, userName: string) =>
    apiFetch<ConnectResult>(`/rtc/bots/${botUserId}/connect`, {
      method: 'POST',
      body: JSON.stringify({ userName }),
    }),
};
