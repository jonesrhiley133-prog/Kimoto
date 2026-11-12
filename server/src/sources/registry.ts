import { q, tx, now, json } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { anilist } from './anilist.js';
import { local } from './local.js';
import { mangadex } from './mangadex.js';
import { kitsu_ } from './kitsu.js';
import { mangaupdates } from './mangaupdates.js';
import type { ChapterMeta, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';

/** Register providers here. Order is the default priority. */
const providers = new Map<string, SourceProvider>([local, mangadex, anilist, kitsu_, mangaupdates].map((p) => [p.id, p]));

export const allProviders = () => [...providers.values()];
export function provider(id: string): SourceProvider {
  const p = providers.get(id);
  if (!p) throw new HttpError(404, `Unknown source "${id}"`);
  return p;
}

/** Providers enabled for a user, ordered by their priority settings. */
export function userProviders(userId?: string): SourceProvider[] {
  const settings = userId ? q.all<{ source: string; enabled: number; priority: number }>('SELECT source, enabled, priority FROM source_settings WHERE user_id = ?', userId) : [];
  const s = new Map(settings.map((r) => [r.source, r]));
  return allProviders()
    .map((p, i) => ({ p, enabled: s.get(p.id)?.enabled ?? 1, priority: s.get(p.id)?.priority ?? i }))
    .filter((x) => x.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map((x) => x.p);
}

export const titleId = (source: string, sourceId: string) => `${source}:${sourceId}`;
export const splitId = (id: string) => {
  const i = id.indexOf(':');
  if (i < 0) throw new HttpError(400, 'Malformed id');
  return { source: id.slice(0, i), sourceId: id.slice(i + 1) };
};

export function upsertTitle(source: string, m: TitleMeta): string {
  const id = titleId(source, m.sourceId);
  q.run(`INSERT INTO titles (id, source, source_id, type, title, alt_titles, description, cover_url, banner_url, authors, artists, genres, tags,
           demographic, status, year, content_rating, languages, original_language, source_rating, source_follows, links, chapter_count, cached_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title, alt_titles=excluded.alt_titles, description=excluded.description,
           cover_url=excluded.cover_url, banner_url=COALESCE(excluded.banner_url, titles.banner_url), authors=excluded.authors, artists=excluded.artists,
           genres=excluded.genres, tags=excluded.tags, demographic=excluded.demographic, status=excluded.status, year=excluded.year,
           content_rating=excluded.content_rating, languages=excluded.languages, original_language=excluded.original_language,
           source_rating=COALESCE(excluded.source_rating, titles.source_rating), source_follows=COALESCE(excluded.source_follows, titles.source_follows),
           links=excluded.links, chapter_count=COALESCE(excluded.chapter_count, titles.chapter_count), cached_at=excluded.cached_at`,
    id, source, m.sourceId, m.type, m.title, JSON.stringify(m.altTitles ?? []), m.description ?? '', m.coverUrl ?? null, m.bannerUrl ?? null,
    JSON.stringify(m.authors ?? []), JSON.stringify(m.artists ?? []), JSON.stringify(m.genres ?? []), JSON.stringify(m.tags ?? []),
    m.demographic ?? null, m.status ?? null, m.year ?? null, m.contentRating ?? null, JSON.stringify(m.languages ?? []), m.originalLanguage ?? null,
    m.rating ?? null, m.follows ?? null, JSON.stringify(m.links ?? {}), m.chapterCount ?? null, now());
  return id;
}

export interface TitleDTO {
  id: string; source: string; sourceId: string; type: string; title: string; altTitles: string[]; description: string;
  coverUrl: string | null; bannerUrl: string | null; authors: string[]; artists: string[]; genres: string[]; tags: string[];
  demographic: string | null; status: string | null; year: number | null; contentRating: string | null; languages: string[];
  originalLanguage: string | null; sourceRating: number | null; sourceFollows: number | null; links: Record<string, string>;
  chapterCount: number | null; readable: boolean;
}

export function toTitle(r: any): TitleDTO {
  return {
    id: r.id, source: r.source, sourceId: r.source_id, type: r.type, title: r.title, altTitles: json(r.alt_titles, []),
    description: r.description, coverUrl: proxied(r.cover_url, r.source), bannerUrl: proxied(r.banner_url, r.source),
    authors: json(r.authors, []), artists: json(r.artists, []), genres: json(r.genres, []), tags: json(r.tags, []),
    demographic: r.demographic, status: r.status, year: r.year, contentRating: r.content_rating, languages: json(r.languages, []),
    originalLanguage: r.original_language, sourceRating: r.source_rating, sourceFollows: r.source_follows, links: json(r.links, {}),
    chapterCount: r.chapter_count, readable: providers.get(r.source)?.capabilities.chapters ?? false,
  };
}

/** Upstream images go through our caching proxy (keeps hotlink rules happy and enables offline caching). */
export function proxied(url: string | null, source: string): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  return `/api/img?src=${encodeURIComponent(source)}&u=${encodeURIComponent(url)}`;
}

export const metaToDTO = (source: string, m: TitleMeta) => {
  const id = upsertTitle(source, m);
  return toTitle(q.get('SELECT * FROM titles WHERE id = ?', id));
};

const STALE_MS = 6 * 3600_000;

export async function loadTitle(id: string, opts: { refresh?: boolean } = {}): Promise<TitleDTO> {
  const cached = q.get('SELECT * FROM titles WHERE id = ?', id);
  if (cached && !opts.refresh && Date.now() - Date.parse(cached.cached_at) < STALE_MS && cached.description !== null) return toTitle(cached);
  const { source, sourceId } = splitId(id);
  try {
    const meta = await provider(source).getTitle(sourceId);
    upsertTitle(source, meta);
    return toTitle(q.get('SELECT * FROM titles WHERE id = ?', id));
  } catch (e) {
    if (cached) return toTitle(cached); // serve stale data when the source is down
    if (e instanceof SourceError) throw new HttpError(e.status === 404 ? 404 : 502, e.message);
    throw e;
  }
}

export interface ChapterDTO {
  id: string; titleId: string; number: number | null; numberLabel: string | null; volume: string | null; name: string | null;
  language: string | null; group: string | null; pages: number | null; publishedAt: string | null; externalUrl: string | null; downloadable: boolean;
}
export const toChapter = (r: any): ChapterDTO => ({
  id: r.id, titleId: r.title_id, number: r.number, numberLabel: r.number_label, volume: r.volume, name: r.name, language: r.language,
  group: r.group_name, pages: r.pages, publishedAt: r.published_at, externalUrl: r.external_url, downloadable: !!r.downloadable,
});

export async function loadChapters(id: string, languages?: string[], refresh = false): Promise<{ chapters: ChapterDTO[]; stale: boolean; error?: string }> {
  const { source, sourceId } = splitId(id);
  const p = provider(source);
  if (!p.capabilities.chapters) return { chapters: [], stale: false };
  const cachedRows = () => q.all('SELECT * FROM chapters WHERE title_id = ? ORDER BY sort_key DESC', id);
  const freshest = q.get<{ c: string }>('SELECT MAX(cached_at) c FROM chapters WHERE title_id = ?', id)?.c;
  const langKey = (languages ?? []).join(',');
  const fresh = freshest && Date.now() - Date.parse(freshest) < 15 * 60_000 && q.get('SELECT 1 FROM kv WHERE key = ? AND value = ?', `chlang:${id}`, langKey);
  if (fresh && !refresh) return { chapters: cachedRows().map(toChapter), stale: false };
  if (!q.get('SELECT 1 FROM titles WHERE id = ?', id)) await loadTitle(id);
  try {
    const list = await p.getChapters(sourceId, { languages });
    saveChapters(id, source, list);
    q.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `chlang:${id}`, langKey);
    return { chapters: cachedRows().map(toChapter), stale: false };
  } catch (e: any) {
    const rows = cachedRows();
    if (rows.length) return { chapters: rows.map(toChapter), stale: true, error: e.message };
    if (e instanceof SourceError) throw new HttpError(e.status === 404 ? 404 : 502, e.message);
    throw e;
  }
}

function saveChapters(titleId: string, source: string, list: ChapterMeta[]) {
  const ts = now();
  tx(() => {
    const keep = new Set<string>();
    list.forEach((c, i) => {
      const cid = `${source}:${c.sourceChapterId}`;
      keep.add(cid);
      // Sort by number; fall back to reverse list position (providers return newest first).
      const sortKey = c.number ?? list.length - i;
      q.run(`INSERT INTO chapters (id, title_id, number, number_label, volume, name, language, group_name, pages, published_at, external_url, downloadable, sort_key, cached_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET number=excluded.number, number_label=excluded.number_label, volume=excluded.volume, name=excluded.name,
               language=excluded.language, group_name=excluded.group_name, pages=excluded.pages, published_at=excluded.published_at,
               external_url=excluded.external_url, downloadable=excluded.downloadable, sort_key=excluded.sort_key, cached_at=excluded.cached_at`,
        cid, titleId, c.number, c.numberLabel ?? (c.number != null ? String(c.number) : null), c.volume ?? null, c.name ?? null, c.language ?? null,
        c.group ?? null, c.pages ?? null, c.publishedAt ?? null, c.externalUrl ?? null, c.downloadable === false ? 0 : 1, sortKey, ts);
    });
    // Drop chapters the source no longer lists (keeps progress rows, which reference ids loosely).
    const existing = q.all<{ id: string }>('SELECT id FROM chapters WHERE title_id = ?', titleId);
    for (const r of existing) if (!keep.has(r.id)) q.run('DELETE FROM chapters WHERE id = ?', r.id);
    const count = list.filter((c) => c.number != null).reduce((m, c) => Math.max(m, c.number!), 0);
    if (count) q.run('UPDATE titles SET chapter_count = MAX(COALESCE(chapter_count, 0), ?) WHERE id = ?', Math.floor(count), titleId);
  });
}

export async function loadPages(chapterId: string, dataSaver = false) {
  const { source, sourceId } = splitId(chapterId);
  try {
    const data = await provider(source).getPages(sourceId, { dataSaver });
    if (data.kind === 'images') {
      return { ...data, pages: data.pages.map((p) => ({ ...p, url: proxied(p.url, source)!, fallbackUrl: p.fallbackUrl ? proxied(p.fallbackUrl, source)! : undefined })) };
    }
    return data;
  } catch (e) {
    if (e instanceof SourceError) throw new HttpError(e.status === 404 ? 404 : 502, e.message);
    throw e;
  }
}

/**
 * Official reading links come from MangaUpdates and AniList. Titles from other catalogs (Kitsu,
 * MangaDex) that know their AniList id borrow AniList's curated links. Best-effort and cached;
 * failures leave the title unchanged.
 */
const enriched = new Map<string, number>();
export async function withOfficialLinks(t: TitleDTO): Promise<TitleDTO> {
  if (t.source === 'anilist' || !t.links.al || Object.keys(t.links).some((k) => k.startsWith('official:'))) return t;
  if (Date.now() - (enriched.get(t.id) ?? 0) < 6 * 3600_000) return t;
  enriched.set(t.id, Date.now());
  try {
    const al = await provider('anilist').getTitle(t.links.al);
    const official = Object.fromEntries(Object.entries(al.links ?? {}).filter(([k]) => k.startsWith('official:')));
    if (!Object.keys(official).length) return t;
    const links = { ...t.links, ...official };
    q.run('UPDATE titles SET links = ? WHERE id = ?', JSON.stringify(links), t.id);
    return { ...t, links };
  } catch {
    return t;
  }
}

/** For metadata-only titles (e.g. from AniList), find readable matches on content providers. */
export async function findReadable(t: TitleDTO, userId?: string) {
  const candidates = userProviders(userId).filter((p) => p.kind === 'content' && p.capabilities.search && (t.type !== 'novel' || p.capabilities.novels));
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const names = new Set([t.title, ...t.altTitles].map(norm));
  const results = await Promise.allSettled(candidates.map(async (p) => {
    const r = await p.search({ query: t.title, limit: 8, offset: 0 });
    return r.items
      .map((m) => ({ m, score: (names.has(norm(m.title)) ? 3 : 0) + (m.altTitles?.some((a) => names.has(norm(a))) ? 2 : 0)
        + (t.links.al && m.links?.al === t.links.al ? 10 : 0) + (t.links.mal && m.links?.mal === t.links.mal ? 10 : 0) }))
      .filter((x) => x.score > 0)
      .map((x) => ({ source: p.id, sourceName: p.name, score: x.score, title: metaToDTO(p.id, x.m) }));
  }));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => b.score - a.score);
}
