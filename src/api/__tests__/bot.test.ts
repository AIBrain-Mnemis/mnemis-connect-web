import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { botApi } from '../bot';

describe('botApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getStatus GETs /rtc/bots/:botUserId and returns BotStatusInfo', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { botUserId: 'bot_a1', status: 'IDLE', lastHeartbeatAt: 1700000000 },
      }),
    });

    const res = await botApi.getStatus('bot_a1');
    expect(res).toEqual({ botUserId: 'bot_a1', status: 'IDLE', lastHeartbeatAt: 1700000000 });

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('/rtc/bots/bot_a1');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('connect POSTs userName and returns ConnectResult', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: {
          status: 'RESERVED',
          sdkAppId: 1400000000,
          roomId: 'r1',
          userId: 'u1',
          userSig: 'sig',
          expiresAt: 1700000999,
          reservationDeadline: 1700000300,
        },
      }),
    });

    const res = await botApi.connect('bot_a1', 'alice');
    expect(res.status).toBe('RESERVED');
    expect(res.roomId).toBe('r1');

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('/rtc/bots/bot_a1/connect');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ userName: 'alice' });
  });

  it('connect surfaces 7409 BOT_BUSY as ApiError', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        errors: [{ code: 7409, message: 'BOT_BUSY' }],
      }),
    });

    await expect(botApi.connect('bot_a1', 'eve')).rejects.toMatchObject({
      code: 7409,
      httpStatus: 409,
    });
  });
});
