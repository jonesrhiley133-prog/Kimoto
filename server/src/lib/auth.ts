import crypto from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { q, now } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from './http.js';
import { sha256 } from './util.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'));
  const expected = Buffer.from(k, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: 'user' | 'moderator' | 'admin';
  email_verified: number;
  banned_until: string | null;
  sessionId: string;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = 'kimoto_session';

export function createSession(res: Response, req: Request, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  q.run('INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha256(token), userId, String(req.headers['user-agent'] ?? '').slice(0, 300), req.ip, expires.toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, expires, path: '/' });
  return token;
}

export function userForToken(token: string | undefined): AuthUser | undefined {
  if (!token) return undefined;
  const sid = sha256(token);
  const row = q.get<AuthUser & { expires_at: string; last_seen_at: string }>(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.email_verified, u.banned_until,
            s.id AS sessionId, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sid);
  if (!row) return undefined;
  if (row.expires_at < now()) {
    q.run('DELETE FROM sessions WHERE id = ?', sid);
    return undefined;
  }
  // Touch the session at most once per 5 minutes.
  if (Date.now() - Date.parse(row.last_seen_at) > 300_000) q.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now(), sid);
  return row;
}

/** Bearer token from the native app, if any. */
export const bearer = (req: Request) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
};

/** Populates req.user from a session cookie (web) or a bearer token (native app). */
export const loadUser: RequestHandler = (req, _res, next) => {
  req.user = userForToken(bearer(req) ?? req.cookies?.[COOKIE]);
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
};
export const requireNotBanned: RequestHandler = (req, _res, next) => {
  if (req.user?.banned_until && req.user.banned_until > now())
    return next(new HttpError(403, `You are suspended from posting until ${req.user.banned_until.slice(0, 10)}.`));
  next();
};
export const isMod = (u?: AuthUser) => !!u && (u.role === 'moderator' || u.role === 'admin');
export const requireMod: RequestHandler = (req, _res, next) => {
  if (!isMod(req.user)) return next(new HttpError(403, 'Moderators only.'));
  next();
};
export const me = (req: Request) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
  return req.user;
};

/**
 * CSRF defense in addition to SameSite=Lax cookies: state-changing requests must carry a custom
 * header, which a cross-origin HTML form cannot set.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-kimoto'] === '1') return next();
  // Bearer-token requests can't be forged by another site (browsers never attach the token automatically).
  if (bearer(req)) return next();
  // sendBeacon cannot set headers; allow it only for the session heartbeat endpoint (same-site cookie still required).
  if (req.path.startsWith('/api/reading/sessions/') && req.path.endsWith('/end')) return next();
  next(new HttpError(403, 'Missing request header.'));
};
