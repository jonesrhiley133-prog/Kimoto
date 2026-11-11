import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now, json } from '../db/index.js';
import { h, body, query, notFound, pageParams } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { id, clean } from '../lib/util.js';
import { take } from '../lib/rateLimit.js';
import { toTitle, toChapter } from '../sources/registry.js';
import { getPrefs } from '../services/prefs.js';
import { applyEntry } from './library.js';

export const reading = Router();
reading.use(requireAuth);

/** In-memory: when the current chapter was opened within each session (for read validation). */
const chapterOpened = new Map<string, { chapterId: string; at: number }>();

function nextChapter(titleId: string, chapterId: string) {
  const cur = q.get('SELECT sort_key, language FROM chapters WHERE id = ?', chapterId);
  if (!cur) return null;
  const n = q.get('SELECT * FROM chapters WHERE title_id = ? AND sort_key > ? ORDER BY (language = ?) DESC, sort_key ASC LIMIT 1', titleId, cur.sort_key, cur.language);
  return n ? toChapter(n) : null;
}

// ---------- Progress ----------
reading.post('/progress', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({
    chapterId: z.string(), titleId: z.string(), page: z.number().int().min(0).max(5000), totalPages: z.number().int().min(0).max(5000),
    scroll: z.number().min(0).max(1).default(0), completed: z.boolean().default(false), sessionId: z.string().nullable().optional(),
  }), req);
  const chapter = q.get('SELECT * FROM chapters WHERE id = ?', b.chapterId);
  if (!chapter || chapter.title_id !== b.titleId) throw notFound('Unknown chapter');
  const prefs = getPrefs(uid);
  const prev = q.get('SELECT * FROM reading_progress WHERE user_id = ? AND chapter_id = ?', uid, b.chapterId);
  const newlyCompleted = b.completed && (!prev || !prev.completed);
  const ts = now();
  let counted = false;
  tx(() => {
    q.run(`INSERT INTO reading_progress (user_id, chapter_id, title_id, page, total_pages, scroll, completed, read_count, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id, chapter_id) DO UPDATE SET page = excluded.page, total_pages = excluded.total_pages, scroll = excluded.scroll,
             completed = MAX(reading_progress.completed, excluded.completed), read_count = reading_progress.read_count + ?, updated_at = excluded.updated_at`,
      uid, b.chapterId, b.titleId, b.page, b.totalPages, b.scroll, b.completed ? 1 : 0, b.completed ? 1 : 0, ts, newlyCompleted ? 1 : 0);

    // A completion counts toward statistics/rankings only if it looks like real reading.
    const title = q.get('SELECT type, genres, status, chapter_count FROM titles WHERE id = ?', b.titleId);
    if (b.completed && prefs.analytics.enabled) {
      const opened = b.sessionId ? chapterOpened.get(b.sessionId) : undefined;
      const minSeconds = title?.type === 'novel' ? 20 : Math.min(30, Math.max(8, (b.totalPages || 10) * 0.8));
      const longEnough = opened?.chapterId === b.chapterId && (Date.now() - opened.at) / 1000 >= minSeconds;
      const recentDup = q.get(`SELECT 1 FROM chapter_reads WHERE user_id = ? AND chapter_id = ? AND read_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')`, uid, b.chapterId);
      if (longEnough && !recentDup && take(`reads:${uid}`, 120, 2)) {
        q.run('INSERT INTO chapter_reads (user_id, title_id, chapter_id, session_id, content_type, genres) VALUES (?,?,?,?,?,?)',
          uid, b.titleId, b.chapterId, b.sessionId ?? null, title?.type ?? null, title?.genres ?? '[]');
        if (b.sessionId) q.run('UPDATE reading_sessions SET chapters_completed = chapters_completed + 1 WHERE id = ? AND user_id = ?', b.sessionId, uid);
        counted = true;
      }
    }

    // Keep the library entry in step with reading.
    const entry = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', uid, b.titleId);
    q.run('UPDATE library_entries SET last_chapter_id = ?, last_read_at = ? WHERE user_id = ? AND title_id = ?', b.chapterId, ts, uid, b.titleId);
    if (b.completed && chapter.number != null) {
      const autoAdd = prefs.reader?.autoAddToLibrary !== false;
      if (entry || autoAdd) {
        const patch: Parameters<typeof applyEntry>[2] = {};
        if (!entry || entry.progress_chapter < chapter.number) patch.progressChapter = chapter.number;
        if (chapter.volume && Number(chapter.volume) > (entry?.progress_volume ?? 0)) patch.progressVolume = Number(chapter.volume);
        if (!entry || entry.status === 'planning' || entry.status === 'on_hold') patch.status = 'reading';
        if (title?.status === 'completed' && title.chapter_count && chapter.number >= title.chapter_count && entry?.status !== 'completed') patch.status = 'completed';
        if (Object.keys(patch).length) applyEntry(uid, b.titleId, patch);
        q.run('UPDATE library_entries SET last_chapter_id = ?, last_read_at = ? WHERE user_id = ? AND title_id = ?', b.chapterId, ts, uid, b.titleId);
      }
    }
  });
  return { ok: true, counted, next: b.completed ? nextChapter(b.titleId, b.chapterId) : undefined };
}));

reading.get('/progress/:chapterId', h((req) => {
  const p = q.get('SELECT * FROM reading_progress WHERE user_id = ? AND chapter_id = ?', me(req).id, req.params.chapterId);
  return p ? { page: p.page, totalPages: p.total_pages, scroll: p.scroll, completed: !!p.completed, updatedAt: p.updated_at } : null;
}));

reading.post('/chapters/mark', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ titleId: z.string(), chapterIds: z.array(z.string()).max(5000), read: z.boolean() }), req);
  tx(() => {
    for (const cid of b.chapterIds) {
      if (b.read) q.run(`INSERT INTO reading_progress (user_id, chapter_id, title_id, completed) VALUES (?,?,?,1)
                         ON CONFLICT(user_id, chapter_id) DO UPDATE SET completed = 1, updated_at = excluded.updated_at`, uid, cid, b.titleId);
      else q.run('DELETE FROM reading_progress WHERE user_id = ? AND chapter_id = ?', uid, cid);
    }
    // Manual marking updates library progress but never counts toward statistics.
    const max = q.get<{ m: number | null }>(`SELECT MAX(c.number) m FROM reading_progress p JOIN chapters c ON c.id = p.chapter_id WHERE p.user_id = ? AND p.title_id = ? AND p.completed = 1`, uid, b.titleId)?.m ?? 0;
    if (q.get('SELECT 1 FROM library_entries WHERE user_id = ? AND title_id = ?', uid, b.titleId) || b.read) applyEntry(uid, b.titleId, { progressChapter: max });
  });
  return { ok: true };
}));

// ---------- Sessions ----------
reading.post('/sessions/start', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ titleId: z.string(), chapterId: z.string().optional(), device: z.string().max(40).optional() }), req);
  if (!getPrefs(uid).analytics.enabled) return { id: null };
  const t = q.get('SELECT type, genres FROM titles WHERE id = ?', b.titleId);
  if (!t) throw notFound();
  const sid = id();
  const ts = now();
  // Close any of this user's sessions left dangling for over 10 minutes.
  q.run(`UPDATE reading_sessions SET ended_at = last_beat_at WHERE user_id = ? AND ended_at IS NULL AND last_beat_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`, uid);
  q.run('INSERT INTO reading_sessions (id, user_id, title_id, chapter_id, started_at, last_beat_at, content_type, genres, device) VALUES (?,?,?,?,?,?,?,?,?)',
    sid, uid, b.titleId, b.chapterId ?? null, ts, ts, t.type, t.genres, b.device ?? null);
  if (b.chapterId) chapterOpened.set(sid, { chapterId: b.chapterId, at: Date.now() });
  return { id: sid };
}));

function beat(uid: string, sid: string, activeDelta: number, pagesDelta: number, chapterId?: string, end = false) {
  const s = q.get('SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?', sid, uid);
  if (!s || s.ended_at) return { ok: false };
  const wall = (Date.now() - Date.parse(s.last_beat_at)) / 1000;
  // Never credit more active time than wall-clock time actually elapsed (+ small slack).
  const credited = Math.max(0, Math.min(activeDelta, wall + 5, 600));
  const ts = now();
  q.run(`UPDATE reading_sessions SET active_seconds = active_seconds + ?, pages_read = pages_read + ?, last_beat_at = ?, chapter_id = COALESCE(?, chapter_id),
           ended_at = ?, flagged = flagged OR ? WHERE id = ?`,
    Math.round(credited), Math.max(0, Math.min(pagesDelta, 500)), ts, chapterId ?? null, end ? ts : null, activeDelta > wall + 30 ? 1 : 0, sid);
  if (chapterId && chapterOpened.get(sid)?.chapterId !== chapterId) chapterOpened.set(sid, { chapterId, at: Date.now() });
  if (end) {
    chapterOpened.delete(sid);
    q.run('DELETE FROM reading_sessions WHERE id = ? AND active_seconds < 5 AND chapters_completed = 0', sid);
  }
  return { ok: true };
}

const beatBody = z.object({ activeSeconds: z.number().min(0).default(0), pagesRead: z.number().int().min(0).default(0), chapterId: z.string().optional() });
reading.post('/sessions/:id/beat', h((req) => {
  const b = body(beatBody, req);
  return beat(me(req).id, req.params.id, b.activeSeconds, b.pagesRead, b.chapterId);
}));
reading.post('/sessions/:id/end', h((req) => {
  // sendBeacon posts text/plain; parse it ourselves.
  const raw = typeof req.body === 'string' ? json(req.body, {}) : req.body;
  const b = beatBody.parse(raw ?? {});
  return beat(me(req).id, req.params.id, b.activeSeconds, b.pagesRead, b.chapterId, true);
}));

// ---------- History & continue reading ----------
reading.get('/history', h((req) => {
  const uid = me(req).id;
  const { limit, offset } = query(pageParams, req);
  const rows = q.all(`SELECT p.*, c.number, c.number_label, c.name AS chapter_name, c.volume, c.language, t.*
                        FROM reading_progress p JOIN titles t ON t.id = p.title_id LEFT JOIN chapters c ON c.id = p.chapter_id
                       WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, uid, limit, offset);
  return rows.map((r) => ({
    chapterId: r.chapter_id, page: r.page, totalPages: r.total_pages, completed: !!r.completed, readAt: r.updated_at,
    chapter: { number: r.number, numberLabel: r.number_label, name: r.chapter_name, volume: r.volume, language: r.language },
    title: toTitle(r),
  }));
}));

reading.get('/continue', h((req) => {
  const uid = me(req).id;
  const limit = Math.min(Number(req.query.limit ?? 12), 50);
  const rows = q.all(`SELECT p.chapter_id, p.page, p.total_pages, p.scroll, p.completed, p.updated_at AS read_at, t.*
                        FROM reading_progress p JOIN titles t ON t.id = p.title_id
                       WHERE p.user_id = ? AND p.updated_at = (SELECT MAX(updated_at) FROM reading_progress p2 WHERE p2.user_id = p.user_id AND p2.title_id = p.title_id)
                         AND NOT EXISTS (SELECT 1 FROM library_entries l WHERE l.user_id = p.user_id AND l.title_id = p.title_id AND l.status IN ('dropped','completed'))
                       ORDER BY p.updated_at DESC LIMIT ?`, uid, limit);
  return rows.map((r) => {
    const cur = q.get('SELECT * FROM chapters WHERE id = ?', r.chapter_id);
    const next = r.completed ? nextChapter(r.id, r.chapter_id) : null;
    return {
      title: toTitle(r), readAt: r.read_at,
      chapter: cur ? toChapter(cur) : null,
      resume: r.completed ? (next ? { chapterId: next.id, page: 0, chapter: next } : null) : { chapterId: r.chapter_id, page: r.page, scroll: r.scroll, chapter: cur ? toChapter(cur) : null },
      progress: r.total_pages ? r.page / Math.max(1, r.total_pages - 1) : r.scroll,
    };
  }).filter((x) => x.resume);
}));

reading.delete('/history', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ chapterId: z.string().optional(), titleId: z.string().optional(), analytics: z.boolean().default(false) }), req);
  tx(() => {
    if (b.chapterId) q.run('DELETE FROM reading_progress WHERE user_id = ? AND chapter_id = ?', uid, b.chapterId);
    else if (b.titleId) q.run('DELETE FROM reading_progress WHERE user_id = ? AND title_id = ?', uid, b.titleId);
    else q.run('DELETE FROM reading_progress WHERE user_id = ?', uid);
    if (b.analytics) {
      if (b.titleId) {
        q.run('DELETE FROM reading_sessions WHERE user_id = ? AND title_id = ?', uid, b.titleId);
        q.run('DELETE FROM chapter_reads WHERE user_id = ? AND title_id = ?', uid, b.titleId);
      } else if (!b.chapterId) {
        q.run('DELETE FROM reading_sessions WHERE user_id = ?', uid);
        q.run('DELETE FROM chapter_reads WHERE user_id = ?', uid);
      }
    }
  });
  return { ok: true };
}));

// ---------- Annotations (bookmarks, notes, saved panels, quotes) ----------
reading.get('/annotations', h((req) => {
  const uid = me(req).id;
  const f = query(z.object({ titleId: z.string().optional(), chapterId: z.string().optional() }), req);
  const rows = q.all(`SELECT a.*, t.title AS t_title, t.cover_url, t.source, c.number_label FROM annotations a JOIN titles t ON t.id = a.title_id LEFT JOIN chapters c ON c.id = a.chapter_id
                       WHERE a.user_id = ? AND (? IS NULL OR a.title_id = ?) AND (? IS NULL OR a.chapter_id = ?) ORDER BY a.created_at DESC LIMIT 500`,
  uid, f.titleId ?? null, f.titleId ?? null, f.chapterId ?? null, f.chapterId ?? null);
  return rows.map((a) => ({
    id: a.id, titleId: a.title_id, chapterId: a.chapter_id, page: a.page, kind: a.kind, note: a.note, quote: a.quote, createdAt: a.created_at,
    titleName: a.t_title, chapterLabel: a.number_label,
  }));
}));
reading.post('/annotations', h((req) => {
  const uid = me(req).id;
  const b = body(z.object({ titleId: z.string(), chapterId: z.string(), page: z.number().int().min(0), kind: z.enum(['bookmark', 'note', 'panel', 'quote']), note: z.string().max(2000).default(''), quote: z.string().max(2000).optional() }), req);
  if (!q.get('SELECT 1 FROM titles WHERE id = ?', b.titleId)) throw notFound();
  const aid = id();
  q.run('INSERT INTO annotations (id, user_id, title_id, chapter_id, page, kind, note, quote) VALUES (?,?,?,?,?,?,?,?)', aid, uid, b.titleId, b.chapterId, b.page, b.kind, clean(b.note), b.quote ?? null);
  return { id: aid };
}));
reading.patch('/annotations/:id', h((req) => {
  const b = body(z.object({ note: z.string().max(2000) }), req);
  const r = q.run('UPDATE annotations SET note = ? WHERE id = ? AND user_id = ?', clean(b.note), req.params.id, me(req).id);
  if (!r.changes) throw notFound();
  return { ok: true };
}));
reading.delete('/annotations/:id', h((req) => {
  const r = q.run('DELETE FROM annotations WHERE id = ? AND user_id = ?', req.params.id, me(req).id);
  if (!r.changes) throw notFound();
  return { ok: true };
}));
