import type { Request, RequestHandler } from 'express';
import { HttpError } from './http.js';

const buckets = new Map<string, { tokens: number; at: number }>();
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, b] of buckets) if (b.at < cutoff) buckets.delete(k);
}, 600_000).unref();

/** Token-bucket check. Returns false when the caller is over the limit. */
export function take(key: string, capacity: number, perMinute: number) {
  if (process.env.KIMOTO_DISABLE_RATE_LIMIT === '1') return true; // test suites only
  const t = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: t };
  b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 60000) * perMinute);
  b.at = t;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export const rateLimit = (name: string, capacity: number, perMinute: number, keyOf?: (r: Request) => string): RequestHandler =>
  (req, _res, next) => {
    const key = `${name}:${keyOf ? keyOf(req) : req.user?.id ?? req.ip}`;
    if (!take(key, capacity, perMinute)) return next(new HttpError(429, 'Slow down a little — too many requests.'));
    next();
  };
