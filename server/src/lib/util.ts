import crypto from 'node:crypto';

export const id = (len = 16) => crypto.randomBytes(Math.ceil((len * 3) / 4)).toString('base64url').slice(0, len);
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip control chars and trim; user text stays plain text (the client renders it escaped). */
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

export function timeoutFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

/** Tiny TTL cache for upstream API responses. */
export class TTLCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private max = 1000) {}
  get(k: string) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V, ttl = this.ttlMs) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!);
    this.m.set(k, { v, exp: Date.now() + ttl });
  }
  async wrap(k: string, fn: () => Promise<V>, ttl?: number) {
    const hit = this.get(k);
    if (hit !== undefined) return hit;
    const v = await fn();
    this.set(k, v, ttl);
    return v;
  }
}
