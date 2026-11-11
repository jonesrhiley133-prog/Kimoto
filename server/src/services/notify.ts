import webpush from 'web-push';
import { q, now, json } from '../db/index.js';
import { config } from '../config.js';
import { id } from '../lib/util.js';
import { emitToUser, isOnline } from '../realtime.js';
import { getPrefs } from './prefs.js';

export type NotificationKind =
  | 'chapter' | 'author' | 'friend' | 'follow' | 'message' | 'reply' | 'reaction' | 'list' | 'community' | 'system';

// VAPID keys: use env if provided, otherwise generate once and persist in the kv table.
let vapid: { publicKey: string; privateKey: string } | null = null;
export function vapidKeys() {
  if (vapid) return vapid;
  if (config.vapid.publicKey && config.vapid.privateKey) vapid = { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey };
  else {
    const row = q.get<{ value: string }>("SELECT value FROM kv WHERE key = 'vapid'");
    vapid = row ? JSON.parse(row.value) : webpush.generateVAPIDKeys();
    if (!row) q.run("INSERT INTO kv (key, value) VALUES ('vapid', ?)", JSON.stringify(vapid));
  }
  webpush.setVapidDetails(config.vapid.subject, vapid!.publicKey, vapid!.privateKey);
  return vapid!;
}

async function push(userId: string, payload: object) {
  vapidKeys();
  const subs = q.all<{ endpoint: string; keys: string }>('SELECT endpoint, keys FROM push_subscriptions WHERE user_id = ?', userId);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: json(s.keys, {}) as any }, JSON.stringify(payload), { TTL: 3600 });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) q.run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
    }
  }));
}

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  actorId?: string;
  imageUrl?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Creates a notification if the recipient has that category enabled and hasn't blocked/muted the actor.
 * Delivered instantly over the socket; pushed to devices when the user is offline (or always, for
 * "instant" frequency with push enabled). Hourly/daily digests are produced by the scheduler.
 */
export function notify(n: NotifyInput) {
  if (n.actorId === n.userId) return null;
  if (n.actorId && q.get('SELECT 1 FROM blocks WHERE user_id = ? AND target_id = ?', n.userId, n.actorId)) return null;
  const prefs = getPrefs(n.userId);
  if (prefs.notifications.categories[n.kind as keyof typeof prefs.notifications.categories] === false) return null;
  const row = {
    id: id(), user_id: n.userId, kind: n.kind, title: n.title.slice(0, 200), body: (n.body ?? '').slice(0, 500), link: n.link ?? null,
    actor_id: n.actorId ?? null, image_url: n.imageUrl ?? null, data: JSON.stringify(n.data ?? {}), read: 0, created_at: now(),
  };
  q.run('INSERT INTO notifications (id, user_id, kind, title, body, link, actor_id, image_url, data, read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    row.id, row.user_id, row.kind, row.title, row.body, row.link, row.actor_id, row.image_url, row.data, 0, row.created_at);
  const dto = toNotification(row);
  emitToUser(n.userId, 'notification', dto);
  if (prefs.notifications.push && prefs.notifications.frequency === 'instant' && (!isOnline(n.userId) || n.kind === 'message')) {
    push(n.userId, { title: row.title, body: row.body, url: row.link ?? '/notifications', tag: n.kind }).catch(() => undefined);
  }
  return dto;
}

export const toNotification = (r: any) => {
  const actor = r.actor_id ? q.get('SELECT u.username, u.display_name, p.avatar_url FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', r.actor_id) : null;
  return {
    id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, imageUrl: r.image_url ?? actor?.avatar_url ?? null,
    actor: actor ? { username: actor.username, displayName: actor.display_name, avatarUrl: actor.avatar_url } : null,
    data: typeof r.data === 'string' ? json(r.data, {}) : r.data, read: !!r.read, createdAt: r.created_at,
  };
};

/** Digest push for users who prefer hourly/daily notifications. */
export async function sendDigests(frequency: 'hourly' | 'daily') {
  const since = new Date(Date.now() - (frequency === 'hourly' ? 3600_000 : 86400_000)).toISOString();
  const users = q.all<{ user_id: string; c: number }>('SELECT user_id, COUNT(*) c FROM notifications WHERE read = 0 AND created_at > ? GROUP BY user_id', since);
  for (const u of users) {
    const p = getPrefs(u.user_id);
    if (p.notifications.frequency !== frequency || !p.notifications.push) continue;
    await push(u.user_id, { title: 'Kimoto', body: `You have ${u.c} new notification${u.c === 1 ? '' : 's'}.`, url: '/notifications', tag: 'digest' });
  }
}
