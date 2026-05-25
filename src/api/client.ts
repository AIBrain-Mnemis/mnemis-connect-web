import type { ApiEnvelope, ApiErrorEnvelope } from './types';

// 开发环境通过 vite proxy 走相对路径 /rtc，避免 CORS。
// 生产环境如部署在不同域名，可显式设置 VITE_API_BASE_URL。
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// 与 docs/rtc-client-integration.md §6 错误码列表对齐
// code 是数字（7404/7409/7410 等），HTTP status 与 code 一对一映射
export class ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 发起请求并解开 { success, result } / { success: false, errors } 外壳。
 * 成功返回 result（类型 T）；失败抛 ApiError。
 * 网络错误抛 ApiError(httpStatus=0, code=0, message)。
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (e: any) {
    throw new ApiError(0, 0, e?.message || 'Network request failed');
  }

  let body: ApiEnvelope<T> | ApiErrorEnvelope;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, 0, `Invalid JSON response (HTTP ${res.status})`);
  }

  if (body && body.success === true) {
    return body.result;
  }

  const err = (body as ApiErrorEnvelope)?.errors?.[0];
  throw new ApiError(res.status, err?.code ?? 0, err?.message || res.statusText || 'Unknown error');
}
