import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiFetch } from '../client';

describe('apiFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('unwraps result on success envelope', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, result: { foo: 1 } }),
    });

    const out = await apiFetch<{ foo: number }>('/x');
    expect(out).toEqual({ foo: 1 });
  });

  it('throws ApiError with numeric code on success:false envelope', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({
        success: false,
        errors: [{ code: 7409, message: 'BOT_BUSY' }],
      }),
    });

    await expect(apiFetch('/x')).rejects.toMatchObject({
      name: 'ApiError',
      httpStatus: 409,
      code: 7409,
      message: 'BOT_BUSY',
    });
  });

  it('throws ApiError(0,0) on network failure', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('boom'));

    await expect(apiFetch('/x')).rejects.toMatchObject({
      name: 'ApiError',
      httpStatus: 0,
      code: 0,
      message: 'boom',
    });
  });

  it('throws ApiError on invalid JSON body', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'ISE',
      json: async () => {
        throw new SyntaxError('not json');
      },
    });

    await expect(apiFetch('/x')).rejects.toMatchObject({
      name: 'ApiError',
      httpStatus: 500,
      code: 0,
    });
  });

  it('forwards JSON Content-Type by default', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: null }),
    });

    await apiFetch('/x', { method: 'POST', body: '{}' });

    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.method).toBe('POST');
  });

  it('ApiError is an instance of Error', () => {
    const e = new ApiError(404, 7404, 'NOT_FOUND');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
  });
});
