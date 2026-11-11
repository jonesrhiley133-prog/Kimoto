import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now, json } from '../db/index.js';
import { h, body, query, notFound, bad, pageParams } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { id } from '../lib/util.js';
import { allProviders } from '../sources/registry.js';
import { getPrefs, patchPrefs } from '../services/prefs.js';
import { toNotification, vapidKeys } from '../services/notify.js';

export const settings = Router();
settings.use(requireAuth);

// ---------- Preferences (one JSON document per user, deep-merged) ----------
settings.get('/prefs', h((req) => getPrefs(me(req).id)));
settings.patch('/prefs', h((req) => {
  const patch = body(z.record(z.unknown()), req);
  if (JSON.stringify(patch).length > 100_000) throw bad('Too large');
  return patchPrefs(me(req).id, patch);
}));

// ---------- Themes ----------
const themeData = z.record(z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'theme too large');
settings.get('/themes', h((req) => q.all('SELECT * FROM themes WHERE user_id = ? ORDER BY created_at', me(req).id).map((t) => ({ id: t.id, name: t.name, data: json(t.data, {}), createdAt: t.created_at }))));
settings.post('/themes', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ name: z.string().min(1).max(60), data: themeData }), req);
  if (q.get<{ c: number }>('SELECT COUNT(*) c FROM themes WHERE user_id = ?', uid)!.c >= 50) throw bad('You can save up to 50 themes.');
  const tid = id();
  q.run('INSERT INTO themes (id, user_id, name, data) VALUES (?,?,?,?)', tid, uid, b.name, JSON.stringify(b.data));
  return { id: tid };
}));
settings.put('/themes/:id', h((req) => {
  const b = body(z.object({ name: z.string().min(1).max(60), data: themeData }), req);
  const r = q.run('UPDATE themes SET name = ?, data = ? WHERE id = ? AND user_id = ?', b.name, JSON.stringify(b.data), req.params.id, me(req).id);
  if (!r.changes) throw notFound();
  return { ok: true };
}));
settings.delete('/themes/:id', h((req) => {
  q.run('DELETE FROM themes WHERE id = ? AND user_id = ?', req.params.id, me(req).id);
  return { ok: true };
}));

// ---------- Dashboard layouts ----------
const layoutData = z.record(z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'layout too large');
settings.get('/layouts', h((req) => q.all('SELECT * FROM layouts WHERE user_id = ? ORDER BY created_at', me(req).id).map((l) => ({ id: l.id, name: l.name, data: json(l.data, {}), active: !!l.active }))));
settings.post('/layouts', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ name: z.string().min(1).max(60), data: layoutData, active: z.boolean().default(true) }), req);
  const lid = id();
  tx(() => {
    if (b.active) q.run('UPDATE layouts SET active = 0 WHERE user_id = ?', uid);
    q.run('INSERT INTO layouts (id, user_id, name, data, active) VALUES (?,?,?,?,?)', lid, uid, b.name, JSON.stringify(b.data), b.active ? 1 : 0);
  });
  return { id: lid };
}));
settings.put('/layouts/:id', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ name: z.string().min(1).max(60).optional(), data: layoutData.optional(), active: z.boolean().optional() }), req);
  tx(() => {
    if (b.active) q.run('UPDATE layouts SET active = 0 WHERE user_id = ?', uid);
    const r = q.run('UPDATE layouts SET name = COALESCE(?, name), data = COALESCE(?, data), active = COALESCE(?, active) WHERE id = ? AND user_id = ?',
      b.name ?? null, b.data ? JSON.stringify(b.data) : null, b.active === undefined ? null : +b.active, req.params.id, uid);
    if (!r.changes) throw notFound();
  });
  return { ok: true };
}));
settings.delete('/layouts/:id', h((req) => {
  q.run('DELETE FROM layouts WHERE id = ? AND user_id = ?', req.params.id, me(req).id);
  return { ok: true };
}));

// ---------- Source management ----------
settings.put('/sources', h((req) => {
  const uid = me(req).id;
  const b = body(z.array(z.object({ id: z.string(), enabled: z.boolean(), config: z.record(z.unknown()).optional() })).max(50), req);
  const known = new Set(allProviders().map((p) => p.id));
  tx(() => b.forEach((s, i) => {
    if (!known.has(s.id)) return;
    q.run(`INSERT INTO source_settings (user_id, source, enabled, priority, config) VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, source) DO UPDATE SET enabled = excluded.enabled, priority = excluded.priority, config = excluded.config`,
    uid, s.id, s.enabled ? 1 : 0, i, JSON.stringify(s.config ?? {}));
  }));
  return { ok: true };
}));

// ---------- Download records (bytes live in the device's offline storage) ----------
settings.get('/downloads', h((req) => {
  const uid = me(req).id;
  const device = String(req.query.device ?? '');
  return q.all(`SELECT d.*, t.title, c.number_label FROM downloads d LEFT JOIN titles t ON t.id = d.title_id LEFT JOIN chapters c ON c.id = d.chapter_id
                 WHERE d.user_id = ? AND (? = '' OR d.device_id = ?) ORDER BY d.updated_at DESC`, uid, device, device)
    .map((d) => ({ deviceId: d.device_id, chapterId: d.chapter_id, titleId: d.title_id, status: d.status, bytes: d.bytes, updatedAt: d.updated_at, title: d.title, chapterLabel: d.number_label }));
}));
settings.put('/downloads', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ deviceId: z.string().max(64), items: z.array(z.object({ chapterId: z.string(), titleId: z.string(), status: z.enum(['queued', 'downloading', 'done', 'error', 'paused']), bytes: z.number().int().min(0) })).max(5000) }), req);
  tx(() => {
    for (const i of b.items) q.run(`INSERT INTO downloads (user_id, device_id, chapter_id, title_id, status, bytes, updated_at) VALUES (?,?,?,?,?,?,?)
                                    ON CONFLICT(user_id, device_id, chapter_id) DO UPDATE SET status = excluded.status, bytes = excluded.bytes, updated_at = excluded.updated_at`,
    uid, b.deviceId, i.chapterId, i.titleId, i.status, i.bytes, now());
  });
  return { ok: true };
}));
settings.delete('/downloads', h((req) => {
  const b = body(z.object({ deviceId: z.string(), chapterIds: z.array(z.string()).optional() }), req);
  if (b.chapterIds) for (const c of b.chapterIds) q.run('DELETE FROM downloads WHERE user_id = ? AND device_id = ? AND chapter_id = ?', me(req).id, b.deviceId, c);
  else q.run('DELETE FROM downloads WHERE user_id = ? AND device_id = ?', me(req).id, b.deviceId);
  return { ok: true };
}));

// ---------- Notifications ----------
export const notifications = Router();
notifications.use(requireAuth);
notifications.get('/', h((req) => {
  const uid = me(req).id;
  const f = query(pageParams.extend({ kind: z.string().optional(), unread: z.string().optional() }), req);
  const rows = q.all(`SELECT * FROM notifications WHERE user_id = ? AND (? IS NULL OR kind = ?) AND (? IS NULL OR read = 0) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    uid, f.kind ?? null, f.kind ?? null, f.unread ? 1 : null, f.limit, f.offset);
  return { items: rows.map(toNotification), unread: q.get<{ c: number }>('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0', uid)!.c };
}));
notifications.post('/read', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }), req);
  if (b.all) q.run('UPDATE notifications SET read = 1 WHERE user_id = ?', uid);
  else for (const nid of b.ids ?? []) q.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', nid, uid);
  return { ok: true };
}));
notifications.delete('/', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ ids: z.array(z.string()).optional(), readOnly: z.boolean().optional() }), req);
  if (b.ids) for (const nid of b.ids) q.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', nid, uid);
  else q.run(`DELETE FROM notifications WHERE user_id = ? ${b.readOnly ? 'AND read = 1' : ''}`, uid);
  return { ok: true };
}));
notifications.get('/push-key', h(() => ({ publicKey: vapidKeys().publicKey })));
notifications.post('/push-subscribe', h((req) => {
  const b = body(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req);
  q.run('INSERT INTO push_subscriptions (endpoint, user_id, keys) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys', b.endpoint, me(req).id, JSON.stringify(b.keys));
  return { ok: true };
}));
notifications.post('/push-unsubscribe', h((req) => {
  const b = body(z.object({ endpoint: z.string() }), req);
  q.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', b.endpoint, me(req).id);
  return { ok: true };
}));
