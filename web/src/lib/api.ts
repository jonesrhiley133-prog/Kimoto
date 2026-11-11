export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { absolutize, getToken, isNative, serverUrl } from './native';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api${url}`, {
      method,
      credentials: isNative ? 'omit' : 'same-origin',
      headers: {
        'x-kimoto': '1',
        ...(isNative ? { 'x-kimoto-client': 'app' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'Could not reach the Kimoto server.' : "You're offline.");
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return absolutize(data) as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  del: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  upload: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ url: string }>('POST', '/uploads', fd);
  },
};

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const enc = encodeURIComponent;
