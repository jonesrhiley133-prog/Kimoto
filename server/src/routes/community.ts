import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now, json } from '../db/index.js';
import { h, body, query, notFound, forbidden, bad, pageParams } from '../lib/http.js';
import { requireAuth, requireNotBanned, requireMod, me, isMod } from '../lib/auth.js';
import { id, clean } from '../lib/util.js';
import { loadTitle, toTitle } from '../sources/registry.js';
import { notify } from '../services/notify.js';
import { logActivity } from '../services/activity.js';
import { checkPost, modLog } from '../services/moderation.js';
import { hiddenUserIds, miniUser, userSelect } from '../services/users.js';

export const community = Router();
const post = [requireAuth, requireNotBanned];

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🤔'];

// ---------------- Comments (chapter, thread, list) ----------------
function commentDTO(c: any, viewer?: string) {
  const reactions = q.all<{ emoji: string; n: number; mine: number }>('SELECT emoji, COUNT(*) n, SUM(user_id = ?) mine FROM comment_reactions WHERE comment_id = ? GROUP BY emoji', viewer ?? '', c.id);
  const removed = c.deleted || c.hidden;
  return {
    id: c.id, parentId: c.parent_id, depth: c.depth, targetType: c.target_type, targetId: c.target_id,
    body: removed ? '' : c.body, spoiler: !!c.spoiler, pinned: !!c.pinned, deleted: !!c.deleted, hidden: !!c.hidden && !c.deleted,
    score: c.score, myVote: viewer ? q.get<{ value: number }>('SELECT value FROM comment_votes WHERE comment_id = ? AND user_id = ?', c.id, viewer)?.value ?? 0 : 0,
    reactions: reactions.map((r) => ({ emoji: r.emoji, count: r.n, mine: !!r.mine })),
    editedAt: c.edited_at, createdAt: c.created_at,
    user: removed ? null : miniUser({ id: c.user_id, username: c.username, display_name: c.display_name, avatar_url: c.avatar_url, role: c.role }),
    mine: c.user_id === viewer,
  };
}

function targetInfo(type: string, targetId: string): { titleId: string | null; ownerId: string | null; link: string; label: string } {
  if (type === 'chapter') {
    const c = q.get('SELECT c.title_id, c.number_label, t.title FROM chapters c JOIN titles t ON t.id = c.title_id WHERE c.id = ?', targetId);
    if (!c) throw notFound('Chapter not found');
    return { titleId: c.title_id, ownerId: null, link: `/read/${encodeURIComponent(targetId)}?comments=1`, label: `${c.title} · Ch. ${c.number_label ?? '?'}` };
  }
  if (type === 'thread') {
    const t = q.get('SELECT * FROM threads WHERE id = ? AND deleted = 0', targetId);
    if (!t) throw notFound('Discussion not found');
    if (t.locked) throw forbidden('This discussion is locked.');
    return { titleId: t.title_id, ownerId: t.user_id, link: `/threads/${targetId}`, label: t.subject };
  }
  if (type === 'list') {
    const l = q.get('SELECT * FROM lists WHERE id = ?', targetId);
    if (!l || l.visibility === 'private') throw notFound('List not found');
    return { titleId: null, ownerId: l.owner_id, link: `/lists/${targetId}`, label: l.name };
  }
  throw bad('Unknown comment target');
}

community.get('/comments', h((req) => {
  const f = query(z.object({ targetType: z.enum(['chapter', 'thread', 'list']), targetId: z.string(), sort: z.enum(['new', 'old', 'top']).default('top') }), req);
  const viewer = req.user?.id;
  const hidden = new Set(hiddenUserIds(viewer));
  const order = f.sort === 'new' ? 'c.created_at DESC' : f.sort === 'old' ? 'c.created_at ASC' : 'c.score DESC, c.created_at DESC';
  const rows = q.all(`SELECT c.*, u.username, u.display_name, u.role, p.avatar_url FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN profiles p ON p.user_id = u.id
                       WHERE c.target_type = ? AND c.target_id = ? ORDER BY c.pinned DESC, ${order} LIMIT 2000`, f.targetType, f.targetId);
  // Keep removed comments only as placeholders when they have replies.
  const hasChildren = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  const visible = rows.filter((r) => !hidden.has(r.user_id) && (!(r.deleted || (r.hidden && !isMod(req.user) && r.user_id !== viewer)) || hasChildren.has(r.id)));
  return { comments: visible.map((c) => commentDTO(c, viewer)), reactions: REACTIONS, total: rows.filter((r) => !r.deleted).length };
}));

community.post('/comments', ...post, h((req) => {
  const u = me(req);
  const b = body(z.object({ targetType: z.enum(['chapter', 'thread', 'list']), targetId: z.string(), parentId: z.string().optional(), body: z.string().min(1).max(5000), spoiler: z.boolean().default(false) }), req);
  const text = clean(b.body);
  if (!text) throw bad('Comment is empty.');
  const info = targetInfo(b.targetType, b.targetId);
  const { hidden } = checkPost(u, text, 'comment');
  let depth = 0;
  let parent: any = null;
  if (b.parentId) {
    parent = q.get('SELECT * FROM comments WHERE id = ? AND target_type = ? AND target_id = ?', b.parentId, b.targetType, b.targetId);
    if (!parent) throw notFound('The comment you replied to is gone.');
    depth = Math.min(parent.depth + 1, 8);
  }
  const cid = id();
  tx(() => {
    q.run('INSERT INTO comments (id, target_type, target_id, title_id, user_id, parent_id, depth, body, spoiler, hidden) VALUES (?,?,?,?,?,?,?,?,?,?)',
      cid, b.targetType, b.targetId, info.titleId, u.id, b.parentId ?? null, depth, text, b.spoiler ? 1 : 0, hidden ? 1 : 0);
    if (b.targetType === 'thread') q.run('UPDATE threads SET reply_count = reply_count + 1, last_activity_at = ? WHERE id = ?', now(), b.targetId);
  });
  if (!hidden) {
    const snippet = b.spoiler ? '(spoiler)' : text.slice(0, 140);
    if (parent && parent.user_id !== u.id) notify({ userId: parent.user_id, kind: 'reply', title: `${u.display_name} replied to your comment`, body: snippet, link: info.link, actorId: u.id, data: { commentId: cid } });
    else if (info.ownerId && info.ownerId !== u.id) notify({ userId: info.ownerId, kind: 'community', title: `${u.display_name} commented on "${info.label}"`, body: snippet, link: info.link, actorId: u.id });
  }
  const row = q.get(`SELECT c.*, u.username, u.display_name, u.role, p.avatar_url FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN profiles p ON p.user_id = u.id WHERE c.id = ?`, cid);
  return { comment: commentDTO(row, u.id), held: hidden };
}));

community.patch('/comments/:id', ...post, h((req) => {
  const u = me(req);
  const b = body(z.object({ body: z.string().min(1).max(5000), spoiler: z.boolean().optional() }), req);
  const c = q.get('SELECT * FROM comments WHERE id = ?', req.params.id);
  if (!c || c.deleted) throw notFound();
  if (c.user_id !== u.id) throw forbidden();
  const { hidden } = checkPost(u, clean(b.body), 'edit');
  q.run('UPDATE comments SET body = ?, spoiler = COALESCE(?, spoiler), edited_at = ?, hidden = MAX(hidden, ?) WHERE id = ?', clean(b.body), b.spoiler === undefined ? null : b.spoiler ? 1 : 0, now(), hidden ? 1 : 0, c.id);
  return { ok: true };
}));

community.delete('/comments/:id', requireAuth, h((req) => {
  const u = me(req);
  const c = q.get('SELECT * FROM comments WHERE id = ?', req.params.id);
  if (!c) throw notFound();
  if (c.user_id !== u.id && !isMod(u)) throw forbidden();
  q.run('UPDATE comments SET deleted = 1 WHERE id = ?', c.id);
  if (c.user_id !== u.id) modLog(u.id, 'delete_comment', 'comment', c.id);
  return { ok: true };
}));

community.post('/comments/:id/vote', requireAuth, h((req) => {
  const uid = me(req).id;
  const { value } = body(z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }), req);
  const c = q.get('SELECT * FROM comments WHERE id = ? AND deleted = 0', req.params.id);
  if (!c) throw notFound();
  tx(() => {
    if (value === 0) q.run('DELETE FROM comment_votes WHERE comment_id = ? AND user_id = ?', c.id, uid);
    else q.run('INSERT INTO comment_votes (comment_id, user_id, value) VALUES (?,?,?) ON CONFLICT DO UPDATE SET value = excluded.value', c.id, uid, value);
    q.run('UPDATE comments SET score = (SELECT COALESCE(SUM(value), 0) FROM comment_votes WHERE comment_id = ?) WHERE id = ?', c.id, c.id);
  });
  if (value === 1 && c.user_id !== uid && !q.get(`SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'reaction' AND data LIKE ?`, c.user_id, `%${c.id}%`)) {
    const info = targetInfo(c.target_type, c.target_id);
    notify({ userId: c.user_id, kind: 'reaction', title: `${me(req).display_name} liked your comment`, body: c.spoiler ? '(spoiler)' : c.body.slice(0, 100), link: info.link, actorId: uid, data: { commentId: c.id } });
  }
  return { score: q.get<{ score: number }>('SELECT score FROM comments WHERE id = ?', c.id)!.score, myVote: value };
}));

community.post('/comments/:id/react', requireAuth, h((req) => {
  const uid = me(req).id;
  const { emoji } = body(z.object({ emoji: z.string().max(16) }), req);
  if (!REACTIONS.includes(emoji) && !q.get('SELECT 1 FROM custom_emoji WHERE name = ?', emoji)) throw bad('Unsupported reaction');
  const c = q.get('SELECT * FROM comments WHERE id = ? AND deleted = 0', req.params.id);
  if (!c) throw notFound();
  const had = q.get('SELECT 1 FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?', c.id, uid, emoji);
  if (had) q.run('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?', c.id, uid, emoji);
  else q.run('INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (?,?,?)', c.id, uid, emoji);
  return { ok: true, active: !had };
}));

community.post('/comments/:id/pin', requireAuth, h((req) => {
  const u = me(req);
  const c = q.get('SELECT * FROM comments WHERE id = ?', req.params.id);
  if (!c) throw notFound();
  const info = targetInfo(c.target_type, c.target_id);
  if (!isMod(u) && info.ownerId !== u.id) throw forbidden('Only moderators or the page owner can pin comments.');
  q.run('UPDATE comments SET pinned = 1 - pinned WHERE id = ?', c.id);
  return { pinned: !c.pinned };
}));

// ---------------- Threads (title-wide discussions) ----------------
const CATEGORIES = ['general', 'characters', 'arcs', 'theories', 'recommendations', 'reviews'] as const;

function threadDTO(t: any, withBody = false) {
  return {
    id: t.id, titleId: t.title_id, category: t.category, subject: t.subject, body: withBody ? t.body : t.body.slice(0, 280), spoiler: !!t.spoiler,
    pinned: !!t.pinned, locked: !!t.locked, replyCount: t.reply_count, lastActivityAt: t.last_activity_at, createdAt: t.created_at,
    user: miniUser({ id: t.user_id, username: t.username, display_name: t.display_name, avatar_url: t.avatar_url, role: t.role }),
    title: t.t_title ? { id: t.title_id, title: t.t_title, coverUrl: toTitle({ id: t.title_id, source: t.t_source, cover_url: t.t_cover, alt_titles: '[]', authors: '[]', artists: '[]', genres: '[]', tags: '[]', languages: '[]', links: '{}' }).coverUrl } : undefined,
  };
}
const THREAD_SELECT = `SELECT th.*, u.username, u.display_name, u.role, p.avatar_url, t.title t_title, t.source t_source, t.cover_url t_cover
  FROM threads th JOIN users u ON u.id = th.user_id LEFT JOIN profiles p ON p.user_id = u.id JOIN titles t ON t.id = th.title_id`;

community.get('/threads', h((req) => {
  const f = query(pageParams.extend({ titleId: z.string().optional(), category: z.enum(CATEGORIES).optional(), sort: z.enum(['active', 'new', 'top']).default('active') }), req);
  const hidden = hiddenUserIds(req.user?.id);
  const order = f.sort === 'new' ? 'th.created_at DESC' : f.sort === 'top' ? 'th.reply_count DESC' : 'th.last_activity_at DESC';
  return q.all(`${THREAD_SELECT} WHERE th.deleted = 0 AND (? IS NULL OR th.title_id = ?) AND (? IS NULL OR th.category = ?)
                 ORDER BY th.pinned DESC, ${order} LIMIT ? OFFSET ?`, f.titleId ?? null, f.titleId ?? null, f.category ?? null, f.category ?? null, f.limit, f.offset)
    .filter((t) => !hidden.includes(t.user_id)).map((t) => threadDTO(t));
}));

community.get('/threads/:id', h((req) => {
  const t = q.get(`${THREAD_SELECT} WHERE th.id = ? AND th.deleted = 0`, req.params.id);
  if (!t) throw notFound('Discussion not found');
  return threadDTO(t, true);
}));

community.post('/threads', ...post, h(async (req) => {
  const u = me(req);
  const b = body(z.object({ titleId: z.string(), category: z.enum(CATEGORIES).default('general'), subject: z.string().min(3).max(150), body: z.string().min(1).max(20000), spoiler: z.boolean().default(false) }), req);
  await loadTitle(b.titleId);
  const { hidden } = checkPost(u, `${b.subject}\n${b.body}`, 'thread');
  if (hidden) throw bad('Your post was flagged by the content filter. Please review the community guidelines.');
  const tid = id();
  q.run('INSERT INTO threads (id, title_id, user_id, category, subject, body, spoiler) VALUES (?,?,?,?,?,?,?)', tid, b.titleId, u.id, b.category, clean(b.subject), clean(b.body), b.spoiler ? 1 : 0);
  return threadDTO(q.get(`${THREAD_SELECT} WHERE th.id = ?`, tid), true);
}));

community.patch('/threads/:id', requireAuth, h((req) => {
  const u = me(req);
  const t = q.get('SELECT * FROM threads WHERE id = ? AND deleted = 0', req.params.id);
  if (!t) throw notFound();
  const b = body(z.object({ subject: z.string().min(3).max(150).optional(), body: z.string().min(1).max(20000).optional(), spoiler: z.boolean().optional(), pinned: z.boolean().optional(), locked: z.boolean().optional() }), req);
  const mod = isMod(u);
  if (t.user_id !== u.id && !mod) throw forbidden();
  if ((b.pinned !== undefined || b.locked !== undefined) && !mod) throw forbidden('Moderators only.');
  q.run(`UPDATE threads SET subject = COALESCE(?, subject), body = COALESCE(?, body), spoiler = COALESCE(?, spoiler), pinned = COALESCE(?, pinned), locked = COALESCE(?, locked) WHERE id = ?`,
    b.subject ? clean(b.subject) : null, b.body ? clean(b.body) : null, b.spoiler === undefined ? null : +b.spoiler, b.pinned === undefined ? null : +b.pinned, b.locked === undefined ? null : +b.locked, t.id);
  if (mod && t.user_id !== u.id) modLog(u.id, 'edit_thread', 'thread', t.id, JSON.stringify(b));
  return { ok: true };
}));

community.delete('/threads/:id', requireAuth, h((req) => {
  const u = me(req);
  const t = q.get('SELECT * FROM threads WHERE id = ?', req.params.id);
  if (!t) throw notFound();
  if (t.user_id !== u.id && !isMod(u)) throw forbidden();
  q.run('UPDATE threads SET deleted = 1 WHERE id = ?', t.id);
  if (t.user_id !== u.id) modLog(u.id, 'delete_thread', 'thread', t.id);
  return { ok: true };
}));

// ---------------- Reviews ----------------
function reviewDTO(r: any, viewer?: string) {
  return {
    id: r.id, titleId: r.title_id, rating: r.rating, body: r.body, spoiler: !!r.spoiler, helpful: r.helpful, createdAt: r.created_at, updatedAt: r.updated_at,
    user: miniUser({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url, role: r.role }), mine: r.user_id === viewer,
    title: r.t_title ? { id: r.title_id, title: r.t_title } : undefined,
  };
}
community.get('/titles/:id/reviews', h((req) => {
  const hidden = hiddenUserIds(req.user?.id);
  return q.all(`SELECT r.*, u.username, u.display_name, u.role, p.avatar_url FROM reviews r JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.user_id = u.id
                 WHERE r.title_id = ? AND r.deleted = 0 ORDER BY r.helpful DESC, r.created_at DESC LIMIT 100`, req.params.id)
    .filter((r) => !hidden.includes(r.user_id)).map((r) => reviewDTO(r, req.user?.id));
}));
community.put('/titles/:id/reviews', ...post, h(async (req) => {
  const u = me(req);
  const b = body(z.object({ rating: z.number().int().min(1).max(10), body: z.string().min(20, 'reviews need at least 20 characters').max(20000), spoiler: z.boolean().default(false) }), req);
  await loadTitle(req.params.id);
  const existing = q.get('SELECT id FROM reviews WHERE title_id = ? AND user_id = ?', req.params.id, u.id);
  if (!existing) checkPost(u, b.body, 'review');
  q.run(`INSERT INTO reviews (id, title_id, user_id, rating, body, spoiler) VALUES (?,?,?,?,?,?)
         ON CONFLICT(title_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, spoiler = excluded.spoiler, deleted = 0, updated_at = ?`,
  existing?.id ?? id(), req.params.id, u.id, b.rating, clean(b.body), b.spoiler ? 1 : 0, now());
  if (!existing) logActivity(u.id, 'reviewed', req.params.id, { rating: b.rating });
  return { ok: true };
}));
community.delete('/reviews/:id', requireAuth, h((req) => {
  const u = me(req);
  const r = q.get('SELECT * FROM reviews WHERE id = ?', req.params.id);
  if (!r) throw notFound();
  if (r.user_id !== u.id && !isMod(u)) throw forbidden();
  q.run('UPDATE reviews SET deleted = 1 WHERE id = ?', r.id);
  return { ok: true };
}));
community.post('/reviews/:id/helpful', requireAuth, h((req) => {
  const uid = me(req).id;
  const r = q.get('SELECT * FROM reviews WHERE id = ?', req.params.id);
  if (!r || r.user_id === uid) throw bad('Cannot vote on this review.');
  const key = `review-helpful:${r.id}:${uid}`;
  if (q.get('SELECT 1 FROM kv WHERE key = ?', key)) return { helpful: r.helpful };
  q.run('INSERT INTO kv (key, value) VALUES (?, ?)', key, '1');
  q.run('UPDATE reviews SET helpful = helpful + 1 WHERE id = ?', r.id);
  return { helpful: r.helpful + 1 };
}));
community.get('/reviews/recent', h(() => q.all(`SELECT r.*, u.username, u.display_name, u.role, p.avatar_url, t.title t_title FROM reviews r JOIN users u ON u.id = r.user_id
  LEFT JOIN profiles p ON p.user_id = u.id JOIN titles t ON t.id = r.title_id WHERE r.deleted = 0 ORDER BY r.created_at DESC LIMIT 20`).map((r) => reviewDTO(r))));

// ---------------- Reports & moderation ----------------
community.post('/reports', requireAuth, h((req) => {
  const uid = me(req).id;
  const b = body(z.object({
    targetType: z.enum(['comment', 'thread', 'review', 'message', 'user', 'list']), targetId: z.string(),
    reason: z.enum(['spam', 'harassment', 'spoiler', 'hate', 'nsfw', 'impersonation', 'other']), details: z.string().max(1000).default(''),
  }), req);
  if (q.get(`SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`, uid, b.targetType, b.targetId)) return { ok: true };
  q.run('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details) VALUES (?,?,?,?,?,?)', id(), uid, b.targetType, b.targetId, b.reason, clean(b.details));
  // Auto-hide content after 3 independent open reports until a moderator reviews it.
  const n = q.get<{ c: number }>(`SELECT COUNT(DISTINCT reporter_id) c FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'`, b.targetType, b.targetId)!.c;
  if (n >= 3 && b.targetType === 'comment') q.run('UPDATE comments SET hidden = 1 WHERE id = ?', b.targetId);
  return { ok: true };
}));

export const mod = Router();
mod.use(requireAuth, requireMod);

function reportTarget(type: string, tid: string) {
  const sql: Record<string, string> = {
    comment: 'SELECT id, user_id, body AS text, hidden, deleted FROM comments WHERE id = ?',
    thread: "SELECT id, user_id, subject || ': ' || body AS text, 0 hidden, deleted FROM threads WHERE id = ?",
    review: 'SELECT id, user_id, body AS text, 0 hidden, deleted FROM reviews WHERE id = ?',
    message: 'SELECT id, user_id, body AS text, 0 hidden, deleted FROM messages WHERE id = ?',
    user: "SELECT id, id AS user_id, display_name || ' (@' || username || ')' AS text, 0 hidden, 0 deleted FROM users WHERE id = ?",
    list: "SELECT id, owner_id AS user_id, name || ': ' || description AS text, 0 hidden, 0 deleted FROM lists WHERE id = ?",
  };
  const r = q.get(sql[type], tid);
  return r ? { ...r, author: miniUser(q.get(`${userSelect} WHERE u.id = ?`, r.user_id)) } : null;
}

mod.get('/reports', h((req) => {
  const status = (req.query.status as string) ?? 'open';
  const rows = q.all(`SELECT r.*, COUNT(*) OVER (PARTITION BY r.target_type, r.target_id) dupes FROM reports r WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`, status);
  return rows.map((r) => ({
    id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, status: r.status, resolution: r.resolution,
    createdAt: r.created_at, reports: r.dupes, reporter: miniUser(q.get(`${userSelect} WHERE u.id = ?`, r.reporter_id)), target: reportTarget(r.target_type, r.target_id),
  }));
}));

mod.post('/reports/:id/resolve', h((req) => {
  const u = me(req);
  const b = body(z.object({ action: z.enum(['dismiss', 'hide', 'delete', 'warn', 'suspend']), days: z.number().int().min(1).max(3650).default(7), note: z.string().max(500).default('') }), req);
  const r = q.get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!r) throw notFound();
  const target = reportTarget(r.target_type, r.target_id);
  tx(() => {
    if (b.action === 'hide' && r.target_type === 'comment') q.run('UPDATE comments SET hidden = 1 WHERE id = ?', r.target_id);
    if (b.action === 'delete') {
      const table: Record<string, string> = { comment: 'comments', thread: 'threads', review: 'reviews', message: 'messages' };
      if (table[r.target_type]) q.run(`UPDATE ${table[r.target_type]} SET deleted = 1 WHERE id = ?`, r.target_id);
      if (r.target_type === 'list') q.run(`UPDATE lists SET visibility = 'private' WHERE id = ?`, r.target_id);
    }
    if (b.action === 'suspend' && target) q.run('UPDATE users SET banned_until = ? WHERE id = ?', new Date(Date.now() + b.days * 86400_000).toISOString(), target.user_id);
    // Resolve every open report about the same target at once.
    q.run(`UPDATE reports SET status = ?, resolution = ?, resolved_by = ? WHERE target_type = ? AND target_id = ? AND status = 'open'`,
      b.action === 'dismiss' ? 'dismissed' : 'resolved', `${b.action}${b.note ? `: ${b.note}` : ''}`, u.id, r.target_type, r.target_id);
  });
  if (target && (b.action === 'warn' || b.action === 'suspend' || b.action === 'delete')) {
    notify({ userId: target.user_id, kind: 'system', title: b.action === 'suspend' ? `Your account is suspended from posting for ${b.days} days` : 'A moderator took action on your content',
      body: b.note || 'Please review the community guidelines.', link: '/guidelines' });
  }
  modLog(u.id, b.action, r.target_type, r.target_id, b.note);
  return { ok: true };
}));

mod.get('/log', h(() => q.all('SELECT m.*, u.username FROM mod_log m LEFT JOIN users u ON u.id = m.moderator_id ORDER BY m.id DESC LIMIT 200')));
mod.get('/filters', h(() => q.all('SELECT * FROM word_filters')));
mod.post('/filters', h((req) => {
  const b = body(z.object({ pattern: z.string().min(1).max(200), action: z.enum(['hide', 'block']) }), req);
  try { new RegExp(b.pattern); } catch { throw bad('Invalid pattern'); }
  q.run('INSERT INTO word_filters (pattern, action) VALUES (?, ?) ON CONFLICT DO UPDATE SET action = excluded.action', b.pattern, b.action);
  modLog(me(req).id, 'add_filter', 'filter', b.pattern);
  return { ok: true };
}));
mod.delete('/filters', h((req) => {
  q.run('DELETE FROM word_filters WHERE pattern = ?', String(req.query.pattern ?? ''));
  return { ok: true };
}));
mod.get('/held', h(() => q.all(`SELECT c.*, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.hidden = 1 AND c.deleted = 0 ORDER BY c.created_at DESC LIMIT 100`)
  .map((c) => ({ id: c.id, body: c.body, username: c.username, targetType: c.target_type, targetId: c.target_id, createdAt: c.created_at }))));
mod.post('/comments/:id/restore', h((req) => {
  q.run('UPDATE comments SET hidden = 0 WHERE id = ?', req.params.id);
  modLog(me(req).id, 'restore_comment', 'comment', req.params.id);
  return { ok: true };
}));
mod.post('/users/:username/role', h((req) => {
  const u = me(req);
  if (u.role !== 'admin') throw forbidden('Admins only.');
  const b = body(z.object({ role: z.enum(['user', 'moderator', 'admin']) }), req);
  const r = q.run('UPDATE users SET role = ? WHERE username = ?', b.role, req.params.username);
  if (!r.changes) throw notFound();
  modLog(u.id, 'set_role', 'user', req.params.username, b.role);
  return { ok: true };
}));
mod.post('/users/:username/unsuspend', h((req) => {
  q.run('UPDATE users SET banned_until = NULL WHERE username = ?', req.params.username);
  modLog(me(req).id, 'unsuspend', 'user', req.params.username);
  return { ok: true };
}));
mod.post('/announce', h((req) => {
  const u = me(req);
  if (u.role !== 'admin') throw forbidden('Admins only.');
  const b = body(z.object({ title: z.string().min(1).max(200), body: z.string().max(1000).default(''), link: z.string().max(300).optional() }), req);
  const ids = q.all<{ id: string }>('SELECT id FROM users').map((r) => r.id);
  for (const uid of ids) notify({ userId: uid, kind: 'system', title: b.title, body: b.body, link: b.link });
  modLog(u.id, 'announce', undefined, undefined, b.title);
  return { sent: ids.length };
}));
mod.get('/overview', h(() => ({
  openReports: q.get<{ c: number }>(`SELECT COUNT(*) c FROM reports WHERE status = 'open'`)!.c,
  heldComments: q.get<{ c: number }>('SELECT COUNT(*) c FROM comments WHERE hidden = 1 AND deleted = 0')!.c,
  suspended: q.all(`${userSelect} WHERE u.banned_until > ?`, now()).map((r) => ({ ...miniUser(r), until: q.get('SELECT banned_until FROM users WHERE id = ?', r.id).banned_until })),
  users: q.get<{ c: number }>('SELECT COUNT(*) c FROM users')!.c,
  commentsToday: q.get<{ c: number }>(`SELECT COUNT(*) c FROM comments WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`)!.c,
})));

