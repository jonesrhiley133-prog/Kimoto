import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { q, json } from '../db/index.js';
import { config } from '../config.js';
import { h, query, HttpError, notFound } from '../lib/http.js';
import { sha256, timeoutFetch, TTLCache } from '../lib/util.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  allProviders, provider, userProviders, loadTitle, withOfficialLinks, loadChapters, loadPages, metaToDTO, toTitle, findReadable, splitId,
} from '../sources/registry.js';
import { safeJoin } from '../sources/local.js';
import { CONTENT_TYPES, type DiscoverSection, type SearchFilters } from '../sources/types.js';
import { getPrefs } from '../services/prefs.js';
import { recommendFor } from '../services/recommend.js';
import { hiddenUserIds, miniUser, userSelect } from '../services/users.js';
import { entryDTO } from './library.js';

export const titles = Router();

const list = z.union([z.string(), z.array(z.string())]).optional().transform((v) => (v == null ? undefined : (Array.isArray(v) ? v : v.split(',')).filter(Boolean)));

titles.get('/sources', h((req) => {
  const settings = req.user ? q.all('SELECT * FROM source_settings WHERE user_id = ?', req.user.id) : [];
  const s = new Map(settings.map((r: any) => [r.source, r]));
  return allProviders().map((p, i) => ({
    id: p.id, name: p.name, description: p.description, website: p.website, kind: p.kind, capabilities: p.capabilities,
    enabled: (s.get(p.id)?.enabled ?? 1) === 1, priority: s.get(p.id)?.priority ?? i,
  })).sort((a, b) => a.priority - b.priority);
}));

titles.get('/sources/:id/genres', h(async (req) => {
  try {
    return await provider(req.params.id).genres();
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
}));

/** Picks the best provider for a discover section from the user's enabled providers. */
const SECTION_PREFERENCE: Record<string, string[]> = {
  trending: ['anilist', 'kitsu', 'mangadex', 'local'], seasonal: ['anilist'], novels: ['anilist', 'kitsu', 'mangaupdates', 'local'],
  latest: ['mangadex', 'local'], new: ['mangadex', 'anilist', 'kitsu', 'mangaupdates', 'local'],
  popular: ['mangadex', 'anilist', 'kitsu', 'mangaupdates', 'local'],
  top_rated: ['anilist', 'mangadex', 'kitsu', 'mangaupdates'], most_followed: ['anilist', 'mangadex', 'kitsu', 'mangaupdates'],
};

titles.get('/discover/:section', h(async (req) => {
  const section = req.params.section as DiscoverSection;
  const o = query(z.object({ source: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(24), offset: z.coerce.number().int().min(0).default(0) }), req);
  const enabled = userProviders(req.user?.id).filter((p) => p.capabilities.discover.includes(section));
  const order = SECTION_PREFERENCE[section] ?? [];
  const rank = (pid: string) => (order.includes(pid) ? order.indexOf(pid) : 99);
  const chosen = o.source ? enabled.find((p) => p.id === o.source) : [...enabled].sort((a, b) => rank(a.id) - rank(b.id))[0];
  if (!chosen) return { source: null, items: [], hasMore: false, available: enabled.map((p) => p.id) };
  const prefs = req.user ? getPrefs(req.user.id) : null;
  try {
    const r = await chosen.discover(section, { limit: o.limit, offset: o.offset, language: prefs?.chapterLanguages?.[0], contentRating: prefs?.contentRating });
    return { source: chosen.id, items: r.items.map((m) => metaToDTO(chosen.id, m)), hasMore: r.hasMore, available: enabled.map((p) => p.id) };
  } catch (e: any) {
    throw new HttpError(502, `${chosen.name}: ${e.message}`);
  }
}));

/** Community-driven sections computed from Kimoto's own data. */
titles.get('/community/:kind', h((req) => {
  const kind = req.params.kind;
  const limit = 24;
  let rows: any[] = [];
  if (kind === 'favorited') {
    rows = q.all(`SELECT t.*, COUNT(*) score FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.favorite = 1 GROUP BY t.id ORDER BY score DESC LIMIT ?`, limit);
  } else if (kind === 'rated') {
    rows = q.all(`SELECT t.*, AVG(l.rating) score, COUNT(l.rating) n FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.rating IS NOT NULL
                   GROUP BY t.id HAVING n >= 1 ORDER BY (AVG(l.rating) * COUNT(l.rating) + 7 * 3) / (COUNT(l.rating) + 3) DESC LIMIT ?`, limit);
  } else if (kind === 'reading') {
    rows = q.all(`SELECT t.*, COUNT(DISTINCT r.user_id) score FROM chapter_reads r JOIN titles t ON t.id = r.title_id
                   WHERE r.read_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') GROUP BY t.id ORDER BY score DESC LIMIT ?`, limit);
  } else throw notFound();
  return { items: rows.map((r) => ({ ...toTitle(r), communityScore: r.score })) };
}));

titles.get('/search', rateLimit('search', 40, 60), h(async (req) => {
  const f = query(z.object({
    source: z.string().default('all'), query: z.string().max(200).optional(), types: list, genres: list, excludeGenres: list,
    demographic: list, status: list, contentRating: list, yearFrom: z.coerce.number().int().optional(), yearTo: z.coerce.number().int().optional(),
    language: z.string().max(10).optional(), author: z.string().max(100).optional(), minRating: z.coerce.number().min(0).max(10).optional(),
    sort: z.enum(['relevance', 'popular', 'rating', 'latest', 'newest', 'title', 'follows']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24), offset: z.coerce.number().int().min(0).default(0),
  }), req);
  f.types = f.types?.filter((t) => (CONTENT_TYPES as string[]).includes(t)) as SearchFilters['types'];
  if (!f.contentRating && req.user) f.contentRating = getPrefs(req.user.id).contentRating;
  const targets = f.source === 'all' ? userProviders(req.user?.id).filter((p) => p.capabilities.search) : [provider(f.source)];
  const results = await Promise.allSettled(targets.map(async (p) => ({ p, r: await p.search(f as SearchFilters) })));
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [{ source: targets[i].id, error: (r.reason as Error).message }] : []));
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  // Interleave results across providers so one source doesn't bury the others. Several metadata
  // catalogs describe the same series, so a metadata result is dropped when an earlier result
  // (in source-priority order) already covers that title; readable results are always kept.
  const items: any[] = [];
  const seen = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const max = Math.max(0, ...ok.map((x) => x.r.items.length));
  for (let i = 0; i < max; i++) {
    for (const { p, r } of ok) {
      const m = r.items[i];
      if (!m) continue;
      const keys = [m.title, ...(m.altTitles ?? []).slice(0, 5)].map((t) => `${m.type}:${norm(t)}`);
      if (p.kind === 'metadata' && keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      items.push(metaToDTO(p.id, m));
    }
  }
  if (!ok.length && errors.length) throw new HttpError(502, errors.map((e) => `${e.source}: ${e.error}`).join(' · '));
  return { items, hasMore: ok.some((x) => x.r.hasMore), errors, total: ok.reduce((n, x) => n + (x.r.total ?? 0), 0) };
}));

titles.get('/random', h(async (req) => {
  const types = query(z.object({ types: list }), req).types;
  const enabled = userProviders(req.user?.id).filter((p) => p.capabilities.discover.includes('popular') && (!types?.includes('novel') || p.capabilities.novels));
  for (const p of enabled.sort(() => Math.random() - 0.5)) {
    try {
      const r = await p.discover('popular', { limit: 50, offset: Math.floor(Math.random() * 4) * 50 });
      const pool = r.items.filter((m) => !types?.length || types.includes(m.type));
      if (pool.length) return metaToDTO(p.id, pool[Math.floor(Math.random() * pool.length)]);
    } catch { /* try the next provider */ }
  }
  const cached = q.get('SELECT * FROM titles ORDER BY RANDOM() LIMIT 1');
  if (cached) return toTitle(cached);
  throw new HttpError(502, 'No sources are reachable right now.');
}));

titles.get('/recommendations', h(async (req) => {
  if (!req.user) return { items: [], reasons: {} };
  return recommendFor(req.user.id, Number(req.query.limit ?? 24));
}));

titles.get('/titles/:id', h(async (req) => {
  const t = await withOfficialLinks(await loadTitle(req.params.id, { refresh: req.query.refresh === '1' }));
  const community = q.get(`SELECT COUNT(*) members, AVG(rating) avg_rating, COUNT(rating) ratings, SUM(favorite) favorites,
                            SUM(status = 'reading') reading, SUM(status = 'completed') completed FROM library_entries WHERE title_id = ?`, t.id);
  const entry = req.user ? q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', req.user.id, t.id) : null;
  const p = provider(t.source);
  return {
    title: t,
    source: { id: p.id, name: p.name, kind: p.kind, website: p.website, download: p.capabilities.download },
    community: {
      members: community.members ?? 0, avgRating: community.avg_rating, ratings: community.ratings ?? 0, favorites: community.favorites ?? 0,
      reading: community.reading ?? 0, completed: community.completed ?? 0,
      threads: q.get<{ c: number }>('SELECT COUNT(*) c FROM threads WHERE title_id = ? AND deleted = 0', t.id)!.c,
      reviews: q.get<{ c: number }>('SELECT COUNT(*) c FROM reviews WHERE title_id = ? AND deleted = 0', t.id)!.c,
    },
    entry: entry ? entryDTO(entry) : null,
  };
}));

titles.get('/titles/:id/chapters', h(async (req) => {
  const id = req.params.id;
  const prefs = req.user ? getPrefs(req.user.id) : null;
  const langs = typeof req.query.lang === 'string' ? req.query.lang.split(',') : prefs?.chapterLanguages ?? ['en'];
  const r = await loadChapters(id, langs, req.query.refresh === '1');
  const progress = req.user
    ? Object.fromEntries(q.all('SELECT chapter_id, page, total_pages, scroll, completed, updated_at FROM reading_progress WHERE user_id = ? AND title_id = ?', req.user.id, id)
      .map((p) => [p.chapter_id, { page: p.page, totalPages: p.total_pages, scroll: p.scroll, completed: !!p.completed, updatedAt: p.updated_at }]))
    : {};
  const commentCounts = Object.fromEntries(q.all(`SELECT target_id, COUNT(*) c FROM comments WHERE target_type = 'chapter' AND title_id = ? AND deleted = 0 GROUP BY target_id`, id)
    .map((c) => [c.target_id, c.c]));
  return { ...r, progress, commentCounts };
}));

titles.get('/titles/:id/related', h(async (req) => {
  const { source, sourceId } = splitId(req.params.id);
  const p = provider(source);
  if (!p.related) return [];
  try {
    return (await p.related(sourceId)).map((m) => metaToDTO(source, m));
  } catch {
    return [];
  }
}));

titles.get('/titles/:id/readable', h(async (req) => {
  const t = await loadTitle(req.params.id);
  return findReadable(t, req.user?.id);
}));

/** Who's reading this — friends first, then public readers. */
titles.get('/titles/:id/readers', h((req) => {
  const hidden = new Set(hiddenUserIds(req.user?.id));
  const rows = q.all(`${userSelect} JOIN library_entries l ON l.user_id = u.id WHERE l.title_id = ? AND p.is_public = 1 ORDER BY l.last_read_at DESC NULLS LAST LIMIT 40`, req.params.id);
  return rows.filter((r) => !hidden.has(r.id) && json<any>(r.visibility, {}).library !== 'private').slice(0, 20).map(miniUser);
}));

titles.get('/chapters/:id', h((req) => {
  const c = q.get('SELECT * FROM chapters WHERE id = ?', req.params.id);
  if (!c) throw notFound('Chapter not found — open it from its title page.');
  return { id: c.id, titleId: c.title_id, number: c.number, numberLabel: c.number_label, volume: c.volume, name: c.name, language: c.language, group: c.group_name, pages: c.pages, externalUrl: c.external_url, downloadable: !!c.downloadable };
}));

titles.get('/chapters/:id/pages', rateLimit('pages', 60, 60), h(async (req) => loadPages(req.params.id, req.query.saver === '1')));

// ---------- Image proxy with disk cache ----------
const inflight = new Map<string, Promise<void>>();
const negative = new TTLCache<true>(60_000);
titles.get('/img', h(async (req, res) => {
  const { src, u } = query(z.object({ src: z.string(), u: z.string().url() }), req);
  const url = new URL(u);
  if (url.protocol !== 'https:' || !provider(src).allowsImageHost(url.hostname)) throw new HttpError(400, 'Image host not allowed');
  const key = sha256(u);
  const file = path.join(config.imageCacheDir, key.slice(0, 2), key);
  const send = () => {
    const type = fs.existsSync(`${file}.type`) ? fs.readFileSync(`${file}.type`, 'utf8') : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    fs.createReadStream(file).pipe(res);
  };
  if (fs.existsSync(file)) return send();
  if (negative.get(key)) throw new HttpError(502, 'Image unavailable');
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const r = await timeoutFetch(u, { headers: { 'User-Agent': config.userAgent, Referer: src === 'mangadex' ? 'https://mangadex.org/' : '' }, timeoutMs: 20000 });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('image/')) throw new Error(`upstream ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 25 * 1024 * 1024) throw new Error('too large');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.type`, type);
      fs.writeFileSync(file, buf);
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    await p;
  } catch {
    negative.set(key, true);
    throw new HttpError(502, 'Image unavailable');
  }
  send();
}));

// ---------- Local library files ----------
titles.get(/^\/sources\/local\/file\/(.+)$/, h((req, res) => {
  const rel = (req.params as any)[0].split('/').map(decodeURIComponent);
  const file = safeJoin(...rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw notFound();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.endsWith('.svg')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file);
}));
