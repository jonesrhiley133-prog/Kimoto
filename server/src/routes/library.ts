import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now, json } from '../db/index.js';
import { h, body, query, notFound } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { loadTitle, toTitle } from '../sources/registry.js';
import { logActivity } from '../services/activity.js';
import { queueSync } from '../services/sync/engine.js';

export const library = Router();
library.use(requireAuth);

export const STATUSES = ['reading', 'completed', 'planning', 'on_hold', 'dropped', 'rereading'] as const;
export type Status = (typeof STATUSES)[number];

export function entryDTO(e: any) {
  return {
    titleId: e.title_id, status: e.status, progressChapter: e.progress_chapter, progressVolume: e.progress_volume,
    rating: e.rating, notes: e.notes, favorite: !!e.favorite, tags: json<string[]>(e.tags, []), notify: !!e.notify, shelf: e.shelf,
    lastChapterId: e.last_chapter_id, lastReadAt: e.last_read_at, startedAt: e.started_at, completedAt: e.completed_at,
    rereadCount: e.reread_count, addedAt: e.added_at, updatedAt: e.updated_at,
  };
}

const entryPatch = z.object({
  status: z.enum(STATUSES).optional(),
  progressChapter: z.number().min(0).max(100000).optional(),
  progressVolume: z.number().int().min(0).max(10000).optional(),
  rating: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().max(5000).optional(),
  favorite: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(30)).max(30).optional(),
  notify: z.boolean().optional(),
  shelf: z.string().max(40).nullable().optional(),
});
export type EntryPatch = z.infer<typeof entryPatch>;

/** Applies a patch to a library entry (creating it if needed). Shared by the API, reader and sync engine. */
export function applyEntry(userId: string, titleId: string, p: EntryPatch, opts: { fromSync?: boolean; at?: string } = {}) {
  const ts = opts.at ?? now();
  return tx(() => {
    const prev = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);
    if (!prev) q.run('INSERT INTO library_entries (user_id, title_id, status) VALUES (?, ?, ?)', userId, titleId, p.status ?? 'planning');
    const cur = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);
    const status = p.status ?? cur.status;
    const sets: Record<string, unknown> = { updated_at: ts };
    if (p.status) sets.status = p.status;
    if (p.progressChapter !== undefined) sets.progress_chapter = p.progressChapter;
    if (p.progressVolume !== undefined) sets.progress_volume = p.progressVolume;
    if (p.rating !== undefined) sets.rating = p.rating;
    if (p.notes !== undefined) sets.notes = p.notes;
    if (p.favorite !== undefined) sets.favorite = p.favorite ? 1 : 0;
    if (p.tags !== undefined) sets.tags = JSON.stringify([...new Set(p.tags.map((t) => t.trim()))]);
    if (p.notify !== undefined) sets.notify = p.notify ? 1 : 0;
    if (p.shelf !== undefined) sets.shelf = p.shelf;
    if ((status === 'reading' || status === 'rereading') && !cur.started_at) sets.started_at = ts;
    if (status === 'completed' && prev?.status !== 'completed') {
      sets.completed_at = ts;
      const t = q.get<{ chapter_count: number | null }>('SELECT chapter_count FROM titles WHERE id = ?', titleId);
      if (t?.chapter_count && p.progressChapter === undefined && cur.progress_chapter < t.chapter_count) sets.progress_chapter = t.chapter_count;
    }
    if (status === 'rereading' && prev?.status === 'completed') sets.reread_count = cur.reread_count + 1;
    const keys = Object.keys(sets);
    q.run(`UPDATE library_entries SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ? AND title_id = ?`, ...(Object.values(sets) as any[]), userId, titleId);
    const next = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);

    if (!opts.fromSync) {
      if (p.status && p.status !== prev?.status) {
        if (p.status === 'reading' && !prev) logActivity(userId, 'started', titleId);
        if (p.status === 'completed') logActivity(userId, 'completed', titleId);
        if (p.status === 'dropped') logActivity(userId, 'dropped', titleId);
      }
      if (p.rating && p.rating !== prev?.rating) logActivity(userId, 'rated', titleId, { rating: p.rating });
      if (p.favorite && !prev?.favorite) logActivity(userId, 'favorited', titleId);
      queueSync(userId, titleId, Boolean(p.status === 'completed' || p.progressChapter !== undefined));
    }
    return next;
  });
}

library.get('/', h((req) => {
  const uid = me(req).id;
  const f = query(z.object({
    status: z.string().optional(), tag: z.string().optional(), favorite: z.string().optional(), shelf: z.string().optional(),
    q: z.string().optional(), type: z.string().optional(),
    sort: z.enum(['updated', 'added', 'title', 'rating', 'progress', 'unread', 'last_read']).default('last_read'),
  }), req);
  const rows = q.all(`SELECT l.*, t.*, l.status AS status, (SELECT COUNT(*) FROM chapters c WHERE c.title_id = t.id) AS known_chapters,
                             (SELECT MAX(c.number) FROM chapters c WHERE c.title_id = t.id) AS latest_number
                        FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ?`, uid);
  let items = rows.map((r) => {
    const title = toTitle(r);
    const latest = r.latest_number ?? r.chapter_count ?? null;
    return { entry: entryDTO(r), title, unread: latest != null ? Math.max(0, Math.floor(latest - r.progress_chapter)) : null };
  });
  if (f.status && f.status !== 'all') items = items.filter((i) => i.entry.status === f.status);
  if (f.favorite === '1') items = items.filter((i) => i.entry.favorite);
  if (f.tag) items = items.filter((i) => i.entry.tags.includes(f.tag!));
  if (f.shelf) items = items.filter((i) => i.entry.shelf === f.shelf);
  if (f.type) items = items.filter((i) => i.title.type === f.type);
  if (f.q) {
    const s = f.q.toLowerCase();
    items = items.filter((i) => i.title.title.toLowerCase().includes(s) || i.title.altTitles.some((a) => a.toLowerCase().includes(s)) || i.entry.notes.toLowerCase().includes(s));
  }
  const by: Record<string, (a: any, b: any) => number> = {
    updated: (a, b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    added: (a, b) => b.entry.addedAt.localeCompare(a.entry.addedAt),
    title: (a, b) => a.title.title.localeCompare(b.title.title),
    rating: (a, b) => (b.entry.rating ?? 0) - (a.entry.rating ?? 0),
    progress: (a, b) => b.entry.progressChapter - a.entry.progressChapter,
    unread: (a, b) => (b.unread ?? 0) - (a.unread ?? 0),
    last_read: (a, b) => (b.entry.lastReadAt ?? b.entry.updatedAt).localeCompare(a.entry.lastReadAt ?? a.entry.updatedAt),
  };
  items.sort(by[f.sort]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { items, counts: { ...counts, all: rows.length, favorites: rows.filter((r) => r.favorite).length } };
}));

library.get('/meta', h((req) => {
  const uid = me(req).id;
  const tags = new Set<string>();
  const shelves = new Set<string>();
  for (const r of q.all('SELECT tags, shelf FROM library_entries WHERE user_id = ?', uid)) {
    json<string[]>(r.tags, []).forEach((t) => tags.add(t));
    if (r.shelf) shelves.add(r.shelf);
  }
  return { tags: [...tags].sort(), shelves: [...shelves].sort() };
}));

library.get('/:titleId', h((req) => {
  const e = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', me(req).id, req.params.titleId);
  return { entry: e ? entryDTO(e) : null };
}));

library.put('/:titleId', h(async (req) => {
  const uid = me(req).id;
  const p = body(entryPatch, req);
  await loadTitle(req.params.titleId); // ensures the title is cached locally
  return { entry: entryDTO(applyEntry(uid, req.params.titleId, p)) };
}));

library.post('/bulk', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ titleIds: z.array(z.string()).min(1).max(500), patch: entryPatch.optional(), remove: z.boolean().optional() }), req);
  tx(() => {
    for (const t of b.titleIds) {
      if (!q.get('SELECT 1 FROM library_entries WHERE user_id = ? AND title_id = ?', uid, t)) continue;
      if (b.remove) q.run('DELETE FROM library_entries WHERE user_id = ? AND title_id = ?', uid, t);
      else if (b.patch) applyEntry(uid, t, b.patch);
    }
  });
  return { ok: true };
}));

library.delete('/:titleId', h((req) => {
  const r = q.run('DELETE FROM library_entries WHERE user_id = ? AND title_id = ?', me(req).id, req.params.titleId);
  if (!r.changes) throw notFound();
  return { ok: true };
}));
