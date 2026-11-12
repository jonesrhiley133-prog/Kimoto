import { Router, type Request } from 'express';
import { z } from 'zod';
import { q, tx, now, json } from '../db/index.js';
import { config } from '../config.js';
import { h, body, HttpError, bad } from '../lib/http.js';
import { hashPassword, verifyPassword, createSession, requireAuth, me, COOKIE } from '../lib/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { sendMail } from '../lib/mail.js';
import { id, sha256 } from '../lib/util.js';
import { getPrefs } from '../services/prefs.js';

export const auth = Router();

/** The native app asks for its session token in the response body (it can't use cookies cross-origin). */
const isApp = (req: Request) => req.headers['x-kimoto-client'] === 'app';

const username = z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscores only');
const password = z.string().min(8, 'at least 8 characters').max(200);
const RESERVED = new Set(['admin', 'kimoto', 'moderator', 'system', 'support', 'me', 'settings', 'api']);

function issueToken(userId: string, kind: 'verify' | 'reset', hours: number) {
  const token = id(40);
  q.run('INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)', sha256(token), userId, kind, new Date(Date.now() + hours * 3600_000).toISOString());
  return token;
}
function consumeToken(token: string, kind: 'verify' | 'reset') {
  const row = q.get<{ user_id: string; expires_at: string; used: number }>('SELECT user_id, expires_at, used FROM email_tokens WHERE id = ? AND kind = ?', sha256(token), kind);
  if (!row || row.used || row.expires_at < now()) throw bad('This link is invalid or has expired.');
  q.run('UPDATE email_tokens SET used = 1 WHERE id = ?', sha256(token));
  return row.user_id;
}
async function sendVerification(userId: string, email: string) {
  const token = issueToken(userId, 'verify', 48);
  await sendMail(email, 'Verify your Kimoto email', `Welcome to Kimoto!\n\nConfirm your email address:\n${config.publicUrl}/verify-email?token=${token}\n\nThis link expires in 48 hours.`);
}

export function sessionUser(userId: string) {
  const u = q.get(`SELECT u.id, u.email, u.username, u.display_name, u.role, u.email_verified, u.created_at, p.avatar_url, p.banner_url
                     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`, userId);
  return {
    id: u.id, email: u.email, username: u.username, displayName: u.display_name, role: u.role, emailVerified: !!u.email_verified,
    avatarUrl: u.avatar_url, bannerUrl: u.banner_url, createdAt: u.created_at, prefs: getPrefs(userId),
  };
}

auth.post('/register', rateLimit('register', 5, 1), h(async (req, res) => {
  const b = body(z.object({ email: z.string().email().max(200), username, password, displayName: z.string().min(1).max(40).optional() }), req);
  if (RESERVED.has(b.username.toLowerCase())) throw bad('That username is reserved.');
  if (q.get('SELECT 1 FROM users WHERE email = ?', b.email)) throw new HttpError(409, 'An account with that email already exists.');
  if (q.get('SELECT 1 FROM users WHERE username = ?', b.username)) throw new HttpError(409, 'That username is taken.');
  const uid = id();
  const hash = await hashPassword(b.password);
  const first = !q.get('SELECT 1 FROM users LIMIT 1');
  tx(() => {
    // The first account on a fresh install becomes the administrator.
    q.run('INSERT INTO users (id, email, username, display_name, password_hash, role) VALUES (?,?,?,?,?,?)', uid, b.email, b.username, b.displayName ?? b.username, hash, first ? 'admin' : 'user');
    q.run('INSERT INTO profiles (user_id) VALUES (?)', uid);
    q.run('INSERT INTO preferences (user_id, data) VALUES (?, ?)', uid, '{}');
  });
  await sendVerification(uid, b.email).catch((e) => console.error('verification mail failed', e));
  const token = createSession(res, req, uid);
  res.status(201);
  return { user: sessionUser(uid), ...(isApp(req) ? { token } : {}) };
}));

auth.post('/login', rateLimit('login', 10, 2), h(async (req, res) => {
  const b = body(z.object({ login: z.string().min(1).max(200), password: z.string().min(1).max(200) }), req);
  const u = q.get<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ? OR username = ?', b.login, b.login);
  // Always run a hash comparison so response timing doesn't reveal whether the account exists.
  const ok = await verifyPassword(b.password, u?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!u || !ok) throw new HttpError(401, 'Incorrect username/email or password.');
  const token = createSession(res, req, u.id);
  return { user: sessionUser(u.id), ...(isApp(req) ? { token } : {}) };
}));

auth.post('/logout', h((req, res) => {
  if (req.user) q.run('DELETE FROM sessions WHERE id = ?', req.user.sessionId);
  res.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
}));

auth.get('/me', h((req) => ({ user: req.user ? sessionUser(req.user.id) : null })));

auth.post('/verify-email', h((req) => {
  const { token } = body(z.object({ token: z.string().min(10) }), req);
  const uid = consumeToken(token, 'verify');
  q.run('UPDATE users SET email_verified = 1 WHERE id = ?', uid);
  return { ok: true };
}));

auth.post('/resend-verification', requireAuth, rateLimit('resend', 3, 0.2), h(async (req) => {
  const u = me(req);
  if (u.email_verified) return { ok: true };
  await sendVerification(u.id, u.email);
  return { ok: true };
}));

auth.post('/forgot-password', rateLimit('forgot', 5, 0.5, (r) => r.ip ?? ''), h(async (req) => {
  const { email } = body(z.object({ email: z.string().email() }), req);
  const u = q.get<{ id: string; email: string }>('SELECT id, email FROM users WHERE email = ?', email);
  if (u) {
    const token = issueToken(u.id, 'reset', 1);
    await sendMail(u.email, 'Reset your Kimoto password', `Someone (hopefully you) asked to reset your password.\n\n${config.publicUrl}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`);
  }
  return { ok: true }; // same answer either way: don't reveal which emails have accounts
}));

auth.post('/reset-password', rateLimit('reset', 10, 1), h(async (req) => {
  const b = body(z.object({ token: z.string().min(10), password }), req);
  const uid = consumeToken(b.token, 'reset');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), uid);
  q.run('DELETE FROM sessions WHERE user_id = ?', uid); // sign out everywhere
  return { ok: true };
}));

auth.post('/change-password', requireAuth, rateLimit('chpw', 5, 1), h(async (req) => {
  const b = body(z.object({ current: z.string(), password }), req);
  const u = me(req);
  const row = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
  if (!(await verifyPassword(b.current, row.password_hash))) throw bad('Your current password is incorrect.');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), u.id);
  q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, u.sessionId);
  return { ok: true };
}));

auth.post('/change-email', requireAuth, rateLimit('chmail', 3, 0.2), h(async (req) => {
  const b = body(z.object({ email: z.string().email().max(200), password: z.string() }), req);
  const u = me(req);
  const row = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
  if (!(await verifyPassword(b.password, row.password_hash))) throw bad('Password is incorrect.');
  if (q.get('SELECT 1 FROM users WHERE email = ? AND id != ?', b.email, u.id)) throw new HttpError(409, 'That email is already in use.');
  q.run('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?', b.email, u.id);
  await sendVerification(u.id, b.email);
  return { user: sessionUser(u.id) };
}));

auth.patch('/account', requireAuth, h((req) => {
  const b = body(z.object({ username: username.optional(), displayName: z.string().min(1).max(40).optional() }), req);
  const u = me(req);
  if (b.username && b.username.toLowerCase() !== u.username.toLowerCase()) {
    if (RESERVED.has(b.username.toLowerCase())) throw bad('That username is reserved.');
    if (q.get('SELECT 1 FROM users WHERE username = ? AND id != ?', b.username, u.id)) throw new HttpError(409, 'That username is taken.');
  }
  if (b.username) q.run('UPDATE users SET username = ? WHERE id = ?', b.username, u.id);
  if (b.displayName) q.run('UPDATE users SET display_name = ? WHERE id = ?', b.displayName, u.id);
  return { user: sessionUser(u.id) };
}));

auth.get('/sessions', requireAuth, h((req) => {
  const u = me(req);
  return q.all('SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', u.id)
    .map((s) => ({ id: s.id.slice(0, 12), userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === u.sessionId }));
}));
auth.delete('/sessions/:prefix', requireAuth, h((req) => {
  const u = me(req);
  const prefix = req.params.prefix;
  if (prefix === 'others') q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, u.sessionId);
  else q.run("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 12) = ?", u.id, prefix);
  return { ok: true };
}));

/** GDPR-style export of everything we store about the user. */
auth.get('/export', requireAuth, rateLimit('export', 3, 0.1), h((req, res) => {
  const uid = me(req).id;
  const t = (table: string, col = 'user_id') => q.all(`SELECT * FROM ${table} WHERE ${col} = ?`, uid);
  const data = {
    exportedAt: now(),
    account: q.get('SELECT id, email, username, display_name, role, email_verified, created_at FROM users WHERE id = ?', uid),
    profile: q.get('SELECT * FROM profiles WHERE user_id = ?', uid),
    preferences: json(q.get<{ data: string }>('SELECT data FROM preferences WHERE user_id = ?', uid)?.data, {}),
    library: q.all('SELECT l.*, t.title, t.source, t.source_id FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ?', uid),
    readingProgress: t('reading_progress'), readingSessions: t('reading_sessions'), chapterReads: t('chapter_reads'), annotations: t('annotations'),
    lists: q.all('SELECT * FROM lists WHERE owner_id = ?', uid).map((l) => ({ ...l, items: q.all('SELECT * FROM list_items WHERE list_id = ?', l.id) })),
    comments: t('comments'), threads: t('threads'), reviews: t('reviews'),
    messages: t('messages'), follows: t('follows', 'follower_id'), friendships: q.all('SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?', uid, uid),
    blocks: t('blocks'), themes: t('themes'), layouts: t('layouts'), notifications: t('notifications'),
    integrations: q.all('SELECT provider, external_id, external_name, settings, last_sync_at FROM integrations WHERE user_id = ?', uid),
  };
  res.setHeader('Content-Disposition', `attachment; filename="kimoto-export-${now().slice(0, 10)}.json"`);
  res.json(data);
}));

auth.post('/delete-account', requireAuth, h(async (req, res) => {
  const b = body(z.object({ password: z.string(), confirm: z.literal('DELETE') }), req);
  const u = me(req);
  const row = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
  if (!(await verifyPassword(b.password, row.password_hash))) throw bad('Password is incorrect.');
  // Cascading foreign keys remove owned rows (library, lists, comments, messages, ...).
  tx(() => q.run('DELETE FROM users WHERE id = ?', u.id));
  res.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
}));
