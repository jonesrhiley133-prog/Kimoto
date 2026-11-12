import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, tx, json } from '../db/index.js';
import { config } from '../config.js';
import { h, body, query, notFound, bad, forbidden, pageParams } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { id, clean } from '../lib/util.js';
import { rateLimit } from '../lib/rateLimit.js';
import { toTitle } from '../sources/registry.js';
import { entryDTO } from './library.js';
import { notify } from '../services/notify.js';
import { logActivity, toActivity, ACTIVITY_SELECT } from '../services/activity.js';
import { getPrefs } from '../services/prefs.js';
import { computeStats } from '../services/stats.js';
import { areFriends, canSee, eitherBlocked, hiddenUserIds, miniUser, presence, sectionVisibility, userSelect, PROFILE_SECTIONS } from '../services/users.js';
import { sessionUser } from './auth.js';

export const users = Router();

// ---------- Uploads ----------
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
export const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (_req, file, cb) => cb(null, `${id(20)}${IMAGE_TYPES[file.mimetype] ?? '.bin'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_TYPES),
});

/** Checks magic bytes so a renamed non-image can't be served as an image. */
export function verifyImage(file?: Express.Multer.File) {
  if (!file) throw bad('Please choose an image (JPEG, PNG, WebP, GIF or AVIF, up to 8 MB).');
  const fd = fs.openSync(file.path, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const ok = head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) || head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || head.subarray(0, 4).toString() === 'GIF8' || (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP')
    || head.subarray(4, 12).toString().startsWith('ftypavi');
  if (!ok) {
    fs.unlinkSync(file.path);
    throw bad('That file is not a valid image.');
  }
  return `/uploads/${path.basename(file.path)}`;
}

users.post('/uploads', requireAuth, rateLimit('upload', 20, 5), upload.single('file'), h((req) => ({ url: verifyImage(req.file) })));

// ---------- Own profile ----------
users.patch('/me/profile', requireAuth, h((req) => {
  const uid = me(req).id;
  const b = body(z.object({
    bio: z.string().max(2000).optional(), avatarUrl: z.string().max(500).nullable().optional(), bannerUrl: z.string().max(500).nullable().optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), region: z.string().max(60).nullable().optional(),
    isPublic: z.boolean().optional(), visibility: z.record(z.enum(PROFILE_SECTIONS), z.enum(['public', 'friends', 'private'])).optional(),
    favoriteGenres: z.array(z.string().max(40)).max(20).optional(),
  }), req);
  const okUrl = (u: string | null | undefined) => u == null || u.startsWith('/uploads/') || /^https:\/\//.test(u);
  if (!okUrl(b.avatarUrl) || !okUrl(b.bannerUrl)) throw bad('Images must be uploaded or use https URLs.');
  const cur = q.get('SELECT * FROM profiles WHERE user_id = ?', uid);
  q.run(`UPDATE profiles SET bio = ?, avatar_url = ?, banner_url = ?, accent = ?, region = ?, is_public = ?, visibility = ?, favorite_genres = ? WHERE user_id = ?`,
    b.bio !== undefined ? clean(b.bio) : cur.bio, b.avatarUrl !== undefined ? b.avatarUrl : cur.avatar_url, b.bannerUrl !== undefined ? b.bannerUrl : cur.banner_url,
    b.accent !== undefined ? b.accent : cur.accent, b.region !== undefined ? (b.region ? clean(b.region) : null) : cur.region,
    b.isPublic !== undefined ? (b.isPublic ? 1 : 0) : cur.is_public,
    b.visibility ? JSON.stringify({ ...json(cur.visibility, {}), ...b.visibility }) : cur.visibility,
    b.favoriteGenres ? JSON.stringify(b.favoriteGenres) : cur.favorite_genres, uid);
  return { user: sessionUser(uid), profile: profileSettings(uid) };
}));

function profileSettings(uid: string) {
  const p = q.get('SELECT * FROM profiles WHERE user_id = ?', uid);
  return { bio: p.bio, avatarUrl: p.avatar_url, bannerUrl: p.banner_url, accent: p.accent, region: p.region, isPublic: !!p.is_public, visibility: sectionVisibility({ visibility: p.visibility }), favoriteGenres: json(p.favorite_genres, []) };
}
users.get('/me/profile', requireAuth, h((req) => profileSettings(me(req).id)));

users.get('/search', h((req) => {
  const { q: s } = query(z.object({ q: z.string().min(1).max(40) }), req);
  const hidden = new Set(hiddenUserIds(req.user?.id));
  return q.all(`${userSelect} WHERE u.username LIKE ? OR u.display_name LIKE ? ORDER BY (u.username = ?) DESC, length(u.username) LIMIT 20`, `${s}%`, `%${s}%`, s)
    .filter((r) => !hidden.has(r.id)).map(miniUser);
}));

// ---------- Public profiles ----------
function relationship(viewer: string | undefined, target: string) {
  if (!viewer || viewer === target) return null;
  const fr = q.get(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`, viewer, target, target, viewer);
  return {
    following: !!q.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', viewer, target),
    followsYou: !!q.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', target, viewer),
    friend: fr?.status === 'accepted' ? 'friends' : fr ? (fr.requester_id === viewer ? 'outgoing' : 'incoming') : 'none',
    blocked: !!q.get(`SELECT 1 FROM blocks WHERE user_id = ? AND target_id = ? AND kind = 'block'`, viewer, target),
    muted: !!q.get(`SELECT 1 FROM blocks WHERE user_id = ? AND target_id = ? AND kind = 'mute'`, viewer, target),
  };
}

users.get('/u/:username', h((req) => {
  const row = q.get(`${userSelect} WHERE u.username = ?`, req.params.username);
  if (!row) throw notFound('User not found');
  const viewer = req.user?.id;
  if (viewer && viewer !== row.id && q.get(`SELECT 1 FROM blocks WHERE user_id = ? AND target_id = ? AND kind = 'block'`, row.id, viewer)) throw notFound('User not found');
  const see = (s: (typeof PROFILE_SECTIONS)[number]) => canSee(row, s, viewer);
  const restricted = !row.is_public && viewer !== row.id && !(viewer && areFriends(viewer, row.id));
  const entries = (where: string, limit = 24) => q.all(`SELECT l.*, t.* , l.status AS status FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ? AND ${where} ORDER BY COALESCE(l.last_read_at, l.updated_at) DESC LIMIT ?`, row.id, limit)
    .map((r) => ({ entry: entryDTO(r), title: toTitle(r) }));
  const integrations = see('integrations') ? q.all('SELECT provider, external_name, external_id FROM integrations WHERE user_id = ?', row.id)
    .map((i) => ({ provider: i.provider, name: i.external_name, url: i.provider === 'mal' ? `https://myanimelist.net/profile/${i.external_name}` : `https://anilist.co/user/${i.external_name}` })) : [];
  const s = see('stats') && !restricted ? computeStats(row.id, 'all', 'UTC') : null;
  return {
    user: { ...miniUser(row), bio: row.bio, bannerUrl: row.banner_url, accent: row.accent, region: see('social') ? row.region : null, joinedAt: row.created_at, isPublic: !!row.is_public },
    restricted,
    presence: presence(row.id),
    relationship: relationship(viewer, row.id),
    counts: {
      followers: q.get<{ c: number }>('SELECT COUNT(*) c FROM follows WHERE followee_id = ?', row.id)!.c,
      following: q.get<{ c: number }>('SELECT COUNT(*) c FROM follows WHERE follower_id = ?', row.id)!.c,
      friends: q.get<{ c: number }>(`SELECT COUNT(*) c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`, row.id, row.id)!.c,
    },
    sections: {
      currentlyReading: see('currentlyReading') ? entries(`l.status IN ('reading','rereading')`, 12) : null,
      completed: see('completed') ? entries(`l.status = 'completed'`, 24) : null,
      favorites: see('favorites') ? entries('l.favorite = 1', 24) : null,
      favoriteGenres: see('favoriteGenres') ? json(row.favorite_genres, []).length ? json(row.favorite_genres, []) : s?.topGenres ?? [] : null,
      stats: s ? { totals: s.totals, library: s.library, genres: s.genres.slice(0, 8), daily: s.daily.slice(-182) } : null,
      integrations,
      lists: see('lists') ? q.all(`SELECT id, name, share_slug, cover_url, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) items FROM lists l WHERE owner_id = ? AND (visibility = 'public' OR ? = owner_id) ORDER BY updated_at DESC LIMIT 12`, row.id, viewer ?? '')
        .map((l) => ({ id: l.id, name: l.name, slug: l.share_slug, coverUrl: l.cover_url, items: l.items })) : null,
      activity: see('activity') ? q.all(`${ACTIVITY_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 20`, row.id).map(toActivity) : null,
    },
    visibility: viewer === row.id ? sectionVisibility(row) : undefined,
  };
}));

users.get('/u/:username/social', h((req) => {
  const row = q.get(`${userSelect} WHERE u.username = ?`, req.params.username);
  if (!row) throw notFound();
  if (!canSee(row, 'social', req.user?.id)) throw forbidden('Hidden by this user.');
  const kind = query(z.object({ kind: z.enum(['followers', 'following', 'friends']) }), req).kind;
  const sql = kind === 'followers' ? `${userSelect} JOIN follows f ON f.follower_id = u.id WHERE f.followee_id = ?`
    : kind === 'following' ? `${userSelect} JOIN follows f ON f.followee_id = u.id WHERE f.follower_id = ?`
    : `${userSelect} WHERE u.id IN (SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1))`;
  return q.all(sql, row.id).map((r) => ({ ...miniUser(r), presence: presence(r.id) }));
}));

// ---------- Follow ----------
users.post('/u/:username/follow', requireAuth, h((req) => {
  const u = me(req);
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (!target || target.id === u.id) throw bad('Cannot follow this user.');
  if (eitherBlocked(u.id, target.id)) throw forbidden('You cannot follow this user.');
  const r = q.run('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING', u.id, target.id);
  if (r.changes) {
    notify({ userId: target.id, kind: 'follow', title: `${u.display_name} started following you`, link: `/u/${u.username}`, actorId: u.id });
    logActivity(u.id, 'followed', null, { username: req.params.username }, target.id);
  }
  return { following: true };
}));
users.delete('/u/:username/follow', requireAuth, h((req) => {
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (target) q.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', me(req).id, target.id);
  return { following: false };
}));

// ---------- Friends ----------
users.get('/friends', requireAuth, h((req) => {
  const uid = me(req).id;
  const rows = q.all(`SELECT f.*, ${'u.id uid'} FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
                       WHERE f.requester_id = ? OR f.addressee_id = ?`, uid, uid, uid);
  const mini = (id2: string) => ({ ...miniUser(q.get(`${userSelect} WHERE u.id = ?`, id2)), presence: presence(id2) });
  return {
    friends: rows.filter((r) => r.status === 'accepted').map((r) => ({ ...mini(r.uid), since: r.created_at })),
    incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === uid).map((r) => ({ ...mini(r.uid), at: r.created_at })),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === uid).map((r) => ({ ...mini(r.uid), at: r.created_at })),
  };
}));
users.post('/u/:username/friend', requireAuth, rateLimit('friend', 20, 2), h((req) => {
  const u = me(req);
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (!target || target.id === u.id) throw bad('Cannot send a request to this user.');
  if (eitherBlocked(u.id, target.id)) throw forbidden('You cannot add this user.');
  const reverse = q.get('SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?', target.id, u.id);
  if (reverse) {
    // They already asked us: accept.
    q.run(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?`, target.id, u.id);
    notify({ userId: target.id, kind: 'friend', title: `${u.display_name} accepted your friend request`, link: `/u/${u.username}`, actorId: u.id });
    return { status: 'friends' };
  }
  if (!getPrefs(target.id).privacy.allowFriendRequests) throw forbidden('This user is not accepting friend requests.');
  const r = q.run('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?) ON CONFLICT DO NOTHING', u.id, target.id);
  if (r.changes) notify({ userId: target.id, kind: 'friend', title: `${u.display_name} sent you a friend request`, link: '/messages?tab=requests', actorId: u.id, data: { requestFrom: u.username } });
  return { status: 'outgoing' };
}));
users.post('/u/:username/friend/respond', requireAuth, h((req) => {
  const u = me(req);
  const b = body(z.object({ accept: z.boolean() }), req);
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (!target) throw notFound();
  if (b.accept) {
    const r = q.run(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`, target.id, u.id);
    if (r.changes) notify({ userId: target.id, kind: 'friend', title: `${u.display_name} accepted your friend request`, link: `/u/${u.username}`, actorId: u.id });
  } else q.run('DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?', target.id, u.id);
  return { ok: true };
}));
users.delete('/u/:username/friend', requireAuth, h((req) => {
  const uid = me(req).id;
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (target) q.run('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)', uid, target.id, target.id, uid);
  return { ok: true };
}));

// ---------- Block / mute ----------
users.get('/blocks', requireAuth, h((req) => q.all(`${userSelect.replace('SELECT', 'SELECT b.kind,')} JOIN blocks b ON b.target_id = u.id WHERE b.user_id = ?`, me(req).id).map((r) => ({ ...miniUser(r), kind: r.kind }))));
users.post('/u/:username/block', requireAuth, h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ kind: z.enum(['block', 'mute']).default('block') }), req);
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (!target || target.id === uid) throw bad('Cannot block this user.');
  tx(() => {
    q.run('INSERT INTO blocks (user_id, target_id, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', uid, target.id, b.kind);
    if (b.kind === 'block') {
      // Blocking severs the social graph in both directions.
      q.run('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', uid, target.id, target.id, uid);
      q.run('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)', uid, target.id, target.id, uid);
    }
  });
  return { ok: true };
}));
users.delete('/u/:username/block', requireAuth, h((req) => {
  const kind = (req.query.kind as string) === 'mute' ? 'mute' : 'block';
  const target = q.get('SELECT id FROM users WHERE username = ?', req.params.username);
  if (target) q.run('DELETE FROM blocks WHERE user_id = ? AND target_id = ? AND kind = ?', me(req).id, target.id, kind);
  return { ok: true };
}));

// ---------- Activity feed ----------
users.get('/feed', requireAuth, h((req) => {
  const uid = me(req).id;
  const { limit, offset } = query(pageParams, req);
  const scope = req.query.scope === 'global' ? 'global' : 'following';
  const hidden = hiddenUserIds(uid);
  const where = scope === 'following'
    ? `(a.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?1)
        OR a.user_id IN (SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1))
        OR a.user_id = ?1)`
    : `EXISTS (SELECT 1 FROM profiles pp WHERE pp.user_id = a.user_id AND pp.is_public = 1)`;
  const rows = q.all(`${ACTIVITY_SELECT} WHERE ${where} ORDER BY a.created_at DESC LIMIT ?2 OFFSET ?3`, uid, limit, offset);
  return rows.filter((r) => !hidden.includes(r.user_id)).map(toActivity);
}));
