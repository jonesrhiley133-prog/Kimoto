import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now } from '../db/index.js';
import { h, body, query, notFound, forbidden, bad } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { id, clean } from '../lib/util.js';
import { loadTitle, toTitle } from '../sources/registry.js';
import { logActivity } from '../services/activity.js';
import { notify } from '../services/notify.js';
import { areFriends, hiddenUserIds, miniUser, userSelect } from '../services/users.js';

export const lists = Router();

function canEdit(list: any, uid?: string) {
  if (!uid) return false;
  if (list.owner_id === uid) return true;
  return !!list.collaborative && !!q.get('SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ? AND accepted = 1', list.id, uid);
}
function canView(list: any, uid?: string, viaSlug = false) {
  if (list.visibility === 'public') return true;
  if (list.visibility === 'unlisted' && viaSlug) return true;
  return canEdit(list, uid) || (!!uid && !!q.get('SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?', list.id, uid));
}

function listDTO(l: any, uid?: string, withItems = false) {
  const owner = miniUser(q.get(`${userSelect} WHERE u.id = ?`, l.owner_id));
  const count = q.get<{ c: number }>('SELECT COUNT(*) c FROM list_items WHERE list_id = ?', l.id)!.c;
  const likes = q.get<{ c: number }>('SELECT COUNT(*) c FROM list_likes WHERE list_id = ?', l.id)!.c;
  const previews = q.all('SELECT t.* FROM list_items i JOIN titles t ON t.id = i.title_id WHERE i.list_id = ? ORDER BY i.position LIMIT 4', l.id).map((t) => toTitle(t).coverUrl);
  const out: any = {
    id: l.id, name: l.name, description: l.description, coverUrl: l.cover_url ?? previews[0] ?? null, previews, visibility: l.visibility,
    slug: l.share_slug, collaborative: !!l.collaborative, createdAt: l.created_at, updatedAt: l.updated_at, owner, itemCount: count, likes,
    liked: uid ? !!q.get('SELECT 1 FROM list_likes WHERE list_id = ? AND user_id = ?', l.id, uid) : false,
    canEdit: canEdit(l, uid), isOwner: l.owner_id === uid,
  };
  if (withItems) {
    out.items = q.all(`SELECT i.position, i.note, i.added_at, i.added_by, t.* FROM list_items i JOIN titles t ON t.id = i.title_id WHERE i.list_id = ? ORDER BY i.position`, l.id)
      .map((r) => ({ position: r.position, note: r.note, addedAt: r.added_at, addedBy: r.added_by, title: toTitle(r) }));
    out.members = q.all(`${userSelect} JOIN list_members m ON m.user_id = u.id WHERE m.list_id = ?`, l.id).map((r) => ({ ...miniUser(r), accepted: !!q.get('SELECT accepted FROM list_members WHERE list_id = ? AND user_id = ?', l.id, r.id)?.accepted }));
  }
  return out;
}

const listInput = z.object({
  name: z.string().min(1).max(80), description: z.string().max(2000).default(''), coverUrl: z.string().max(500).nullable().optional(),
  visibility: z.enum(['private', 'unlisted', 'public']).default('private'), collaborative: z.boolean().default(false),
});

lists.get('/mine', requireAuth, h((req) => {
  const uid = me(req).id;
  return q.all(`SELECT l.* FROM lists l WHERE l.owner_id = ? OR l.id IN (SELECT list_id FROM list_members WHERE user_id = ? AND accepted = 1) ORDER BY l.updated_at DESC`, uid, uid)
    .map((l) => listDTO(l, uid));
}));

lists.get('/invites', requireAuth, h((req) => {
  const uid = me(req).id;
  return q.all('SELECT l.* FROM lists l JOIN list_members m ON m.list_id = l.id WHERE m.user_id = ? AND m.accepted = 0', uid).map((l) => listDTO(l, uid));
}));

lists.get('/public', h((req) => {
  const f = query(z.object({ sort: z.enum(['popular', 'recent']).default('popular'), q: z.string().max(100).optional(), user: z.string().optional(), limit: z.coerce.number().max(60).default(24), offset: z.coerce.number().default(0) }), req);
  const hidden = hiddenUserIds(req.user?.id);
  const rows = q.all(`SELECT l.*, (SELECT COUNT(*) FROM list_likes k WHERE k.list_id = l.id) likes FROM lists l JOIN users u ON u.id = l.owner_id
                       WHERE l.visibility = 'public' AND (? IS NULL OR l.name LIKE ?) AND (? IS NULL OR u.username = ?)
                         AND EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id)
                       ORDER BY ${f.sort === 'popular' ? 'likes DESC, l.updated_at DESC' : 'l.updated_at DESC'} LIMIT ? OFFSET ?`,
  f.q ?? null, f.q ? `%${f.q}%` : null, f.user ?? null, f.user ?? null, f.limit, f.offset);
  return rows.filter((l) => !hidden.includes(l.owner_id)).map((l) => listDTO(l, req.user?.id));
}));

lists.get('/containing/:titleId', requireAuth, h((req) => {
  const uid = me(req).id;
  return q.all<{ list_id: string }>(`SELECT i.list_id FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.title_id = ? AND (l.owner_id = ? OR l.id IN (SELECT list_id FROM list_members WHERE user_id = ? AND accepted = 1))`, req.params.titleId, uid, uid).map((r) => r.list_id);
}));

lists.post('/', requireAuth, h((req) => {
  const uid = me(req).id;
  const b = body(listInput, req);
  if (q.get<{ c: number }>('SELECT COUNT(*) c FROM lists WHERE owner_id = ?', uid)!.c >= 500) throw bad('List limit reached.');
  const lid = id();
  q.run('INSERT INTO lists (id, owner_id, name, description, cover_url, visibility, share_slug, collaborative) VALUES (?,?,?,?,?,?,?,?)',
    lid, uid, clean(b.name), clean(b.description), b.coverUrl ?? null, b.visibility, id(10), b.collaborative ? 1 : 0);
  if (b.visibility === 'public') logActivity(uid, 'list_created', null, { name: b.name }, lid);
  return listDTO(q.get('SELECT * FROM lists WHERE id = ?', lid), uid);
}));

function getList(idOrSlug: string) {
  const l = q.get('SELECT * FROM lists WHERE id = ? OR share_slug = ?', idOrSlug, idOrSlug);
  if (!l) throw notFound('List not found');
  return l;
}

lists.get('/:id', h((req) => {
  const l = getList(req.params.id);
  if (!canView(l, req.user?.id, l.share_slug === req.params.id)) throw notFound('List not found');
  return listDTO(l, req.user?.id, true);
}));

lists.patch('/:id', requireAuth, h((req) => {
  const uid = me(req).id;
  const l = getList(req.params.id);
  if (l.owner_id !== uid) throw forbidden('Only the owner can change list settings.');
  const b = body(listInput.partial(), req);
  q.run(`UPDATE lists SET name = COALESCE(?, name), description = COALESCE(?, description), cover_url = CASE WHEN ? THEN ? ELSE cover_url END,
           visibility = COALESCE(?, visibility), collaborative = COALESCE(?, collaborative), updated_at = ? WHERE id = ?`,
  b.name ? clean(b.name) : null, b.description !== undefined ? clean(b.description) : null, b.coverUrl !== undefined ? 1 : 0, b.coverUrl ?? null,
  b.visibility ?? null, b.collaborative === undefined ? null : b.collaborative ? 1 : 0, now(), l.id);
  return listDTO(q.get('SELECT * FROM lists WHERE id = ?', l.id), uid, true);
}));

lists.delete('/:id', requireAuth, h((req) => {
  const l = getList(req.params.id);
  if (l.owner_id !== me(req).id) throw forbidden();
  q.run('DELETE FROM lists WHERE id = ?', l.id);
  return { ok: true };
}));

lists.post('/:id/regenerate-link', requireAuth, h((req) => {
  const l = getList(req.params.id);
  if (l.owner_id !== me(req).id) throw forbidden();
  const slug = id(10);
  q.run('UPDATE lists SET share_slug = ? WHERE id = ?', slug, l.id);
  return { slug };
}));

lists.post('/:id/items', requireAuth, h(async (req) => {
  const uid = me(req).id;
  const l = getList(req.params.id);
  if (!canEdit(l, uid)) throw forbidden();
  const b = body(z.object({ titleId: z.string(), note: z.string().max(500).default('') }), req);
  await loadTitle(b.titleId);
  const max = q.get<{ m: number | null }>('SELECT MAX(position) m FROM list_items WHERE list_id = ?', l.id)?.m ?? 0;
  q.run('INSERT INTO list_items (list_id, title_id, position, note, added_by) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', l.id, b.titleId, max + 1, clean(b.note), uid);
  q.run('UPDATE lists SET updated_at = ? WHERE id = ?', now(), l.id);
  if (l.visibility === 'public') logActivity(uid, 'list_added', b.titleId, { list: l.name }, l.id);
  return { ok: true };
}));

lists.patch('/:id/items/:titleId', requireAuth, h((req) => {
  const l = getList(req.params.id);
  if (!canEdit(l, me(req).id)) throw forbidden();
  const b = body(z.object({ note: z.string().max(500) }), req);
  q.run('UPDATE list_items SET note = ? WHERE list_id = ? AND title_id = ?', clean(b.note), l.id, req.params.titleId);
  return { ok: true };
}));

lists.delete('/:id/items/:titleId', requireAuth, h((req) => {
  const l = getList(req.params.id);
  if (!canEdit(l, me(req).id)) throw forbidden();
  q.run('DELETE FROM list_items WHERE list_id = ? AND title_id = ?', l.id, req.params.titleId);
  q.run('UPDATE lists SET updated_at = ? WHERE id = ?', now(), l.id);
  return { ok: true };
}));

/** Drag-and-drop reorder: client sends the full ordered list of title ids. */
lists.put('/:id/order', requireAuth, h((req) => {
  const l = getList(req.params.id);
  if (!canEdit(l, me(req).id)) throw forbidden();
  const b = body(z.object({ titleIds: z.array(z.string()).max(5000) }), req);
  tx(() => b.titleIds.forEach((t, i) => q.run('UPDATE list_items SET position = ? WHERE list_id = ? AND title_id = ?', i + 1, l.id, t)));
  q.run('UPDATE lists SET updated_at = ? WHERE id = ?', now(), l.id);
  return { ok: true };
}));

lists.post('/:id/like', requireAuth, h((req) => {
  const uid = me(req).id;
  const l = getList(req.params.id);
  if (!canView(l, uid, true)) throw notFound();
  const liked = q.get('SELECT 1 FROM list_likes WHERE list_id = ? AND user_id = ?', l.id, uid);
  if (liked) q.run('DELETE FROM list_likes WHERE list_id = ? AND user_id = ?', l.id, uid);
  else {
    q.run('INSERT INTO list_likes (list_id, user_id) VALUES (?, ?)', l.id, uid);
    notify({ userId: l.owner_id, kind: 'community', title: `${me(req).display_name} liked your list "${l.name}"`, link: `/lists/${l.id}`, actorId: uid });
  }
  return { liked: !liked };
}));

// ---------- Collaboration ----------
lists.post('/:id/members', requireAuth, h((req) => {
  const u = me(req);
  const l = getList(req.params.id);
  if (l.owner_id !== u.id) throw forbidden();
  const b = body(z.object({ username: z.string() }), req);
  const target = q.get('SELECT id FROM users WHERE username = ?', b.username);
  if (!target) throw notFound('User not found');
  if (target.id === u.id) throw bad("You're already the owner.");
  if (!areFriends(u.id, target.id)) throw bad('You can only invite friends to collaborate.');
  q.run('INSERT INTO list_members (list_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', l.id, target.id);
  q.run('UPDATE lists SET collaborative = 1 WHERE id = ?', l.id);
  notify({ userId: target.id, kind: 'list', title: `${u.display_name} invited you to collaborate on "${l.name}"`, link: `/lists/${l.id}`, actorId: u.id, data: { listId: l.id } });
  return { ok: true };
}));
lists.post('/:id/members/respond', requireAuth, h((req) => {
  const uid = me(req).id;
  const l = getList(req.params.id);
  const b = body(z.object({ accept: z.boolean() }), req);
  if (b.accept) q.run('UPDATE list_members SET accepted = 1 WHERE list_id = ? AND user_id = ?', l.id, uid);
  else q.run('DELETE FROM list_members WHERE list_id = ? AND user_id = ?', l.id, uid);
  return { ok: true };
}));
lists.delete('/:id/members/:userId', requireAuth, h((req) => {
  const uid = me(req).id;
  const l = getList(req.params.id);
  if (l.owner_id !== uid && req.params.userId !== uid) throw forbidden();
  q.run('DELETE FROM list_members WHERE list_id = ? AND user_id = ?', l.id, req.params.userId);
  return { ok: true };
}));
