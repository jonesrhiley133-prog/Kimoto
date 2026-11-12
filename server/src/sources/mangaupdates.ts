import { config } from '../config.js';
import { TTLCache, timeoutFetch, sleep } from '../lib/util.js';
import type { ContentType, DiscoverSection, SearchFilters, SearchResult, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';
import { cleanDescription, extractOfficialLinks } from './official.js';

/**
 * MangaUpdates (Baka-Updates) — official public API, https://api.mangaupdates.com/v1.
 *
 * A metadata catalog: series information, ratings, licensing and — importantly — where each series
 * is officially published. Those links appear on the title page as "Read officially" buttons.
 * MangaUpdates hosts no chapters, so reading happens on official sites or Kimoto's content sources.
 */
const API = 'https://api.mangaupdates.com/v1';
const cache = new TTLCache<any>(15 * 60_000, 1500);

// Be polite: one request at a time, at most ~3 per second.
let chain: Promise<unknown> = Promise.resolve();
let last = 0;
function mu<T = any>(path: string, body?: unknown, ttl?: number): Promise<T> {
  const key = `${path}|${body ? JSON.stringify(body) : ''}`;
  return cache.wrap(key, () => {
    const p = chain.then(async () => {
      const wait = 350 - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res: Response;
      try {
        res = await timeoutFetch(`${API}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new SourceError('mangaupdates', 'MangaUpdates is unreachable right now.');
      }
      if (res.status === 404) throw new SourceError('mangaupdates', 'Not found on MangaUpdates.', 404);
      if (res.status === 429) throw new SourceError('mangaupdates', 'MangaUpdates rate limit reached — try again in a minute.', 429);
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !j || j.status === 'exception') throw new SourceError('mangaupdates', j?.reason ?? `MangaUpdates error (${res.status})`);
      return j as T;
    });
    chain = p.catch(() => undefined);
    return p;
  }, ttl);
}

const ADULT = ['Adult', 'Hentai', 'Smut'];
const SUGGESTIVE = ['Ecchi', 'Mature'];
const NEVER = ['Lolicon', 'Shotacon']; // never shown
const TYPE_OF: Record<string, ContentType> = { Manga: 'manga', Manhwa: 'manhwa', Manhua: 'manhua', Novel: 'novel', OEL: 'manga' };
const MU_TYPES: Record<ContentType, string[]> = { manga: ['Manga', 'OEL'], manhwa: ['Manhwa'], manhua: ['Manhua'], webtoon: ['Manhwa'], novel: ['Novel'] };
const DEFAULT_TYPES = ['Manga', 'Manhwa', 'Manhua', 'Novel', 'OEL']; // skips doujinshi, artbooks, drama CDs…

function ratingOf(genres: string[]): string {
  if (genres.some((g) => ADULT.includes(g))) return 'erotica';
  if (genres.some((g) => SUGGESTIVE.includes(g))) return 'suggestive';
  return 'safe';
}
function excludedGenres(contentRating?: string[]) {
  const allowed = contentRating?.length ? contentRating : ['safe', 'suggestive'];
  const out = [...NEVER];
  if (!allowed.includes('erotica') && !allowed.includes('pornographic')) out.push(...ADULT);
  if (!allowed.includes('suggestive')) out.push(...SUGGESTIVE);
  return out;
}
function statusOf(s: string | null | undefined, completed?: boolean): string | null {
  if (completed) return 'completed';
  const t = (s ?? '').toLowerCase();
  if (/ongoing/.test(t)) return 'ongoing';
  if (/complete/.test(t)) return 'completed';
  if (/hiatus/.test(t)) return 'hiatus';
  if (/cancel|discontinu|dropped/.test(t)) return 'cancelled';
  return null;
}
const slugOf = (url?: string) => url?.match(/\/series\/([a-z0-9]+)/i)?.[1];

function toMeta(r: any): TitleMeta {
  const genres: string[] = (r.genres ?? []).map((g: any) => g.genre);
  const description = String(r.description ?? '');
  const slug = slugOf(r.url);
  return {
    sourceId: String(r.series_id),
    type: TYPE_OF[r.type] ?? 'manga',
    title: r.title,
    altTitles: (r.associated ?? []).map((a: any) => a.title).filter(Boolean).slice(0, 20),
    description: cleanDescription(description),
    coverUrl: r.image?.url?.original ?? null,
    authors: (r.authors ?? []).filter((a: any) => a.type === 'Author').map((a: any) => a.name),
    artists: (r.authors ?? []).filter((a: any) => a.type === 'Artist').map((a: any) => a.name),
    genres: genres.filter((g) => !['Shounen', 'Shoujo', 'Seinen', 'Josei'].includes(g)),
    tags: (r.categories ?? []).filter((c: any) => (c.votes ?? 0) >= 2).slice(0, 25).map((c: any) => c.category),
    demographic: (['Shounen', 'Shoujo', 'Seinen', 'Josei'].find((d) => genres.includes(d)) ?? null)?.toLowerCase() ?? null,
    status: statusOf(r.status, r.completed),
    year: Number(r.year) || null,
    contentRating: ratingOf(genres),
    languages: [],
    rating: r.bayesian_rating ? Number(r.bayesian_rating) : null,
    follows: r.rank?.lists?.reading ?? null,
    links: { ...(slug ? { mu: slug } : {}), ...extractOfficialLinks(description) },
    chapterCount: r.latest_chapter ? Number(r.latest_chapter) || null : null,
  };
}

const ORDER: Record<string, string> = { popular: 'list_reading', follows: 'list_reading', rating: 'rating', title: 'title', newest: 'date_added', latest: 'date_added' };

async function search(f: Partial<SearchFilters>): Promise<SearchResult> {
  // MangaUpdates ignores page sizes below ~10 (falls back to 25), so ask for at least 10 and trim.
  const limit = Math.min(f.limit ?? 24, 50);
  const offset = f.offset ?? 0;
  const perpage = Math.max(10, limit);
  const page = Math.floor(offset / perpage) + 1;
  const skip = offset - (page - 1) * perpage;
  const body: Record<string, unknown> = {
    page, perpage,
    type: f.types?.length ? [...new Set(f.types.flatMap((t) => MU_TYPES[t]))] : DEFAULT_TYPES,
    exclude_genre: [...new Set([...excludedGenres(f.contentRating), ...(f.excludeGenres ?? [])])],
    orderby: f.query && (!f.sort || f.sort === 'relevance') ? 'score' : ORDER[f.sort ?? 'popular'] ?? 'list_reading',
  };
  if (f.query) body.search = f.query;
  if (f.genres?.length) body.genre = f.genres;
  if (f.yearFrom && f.yearFrom === f.yearTo) body.year = String(f.yearFrom);
  const r = await mu('/series/search', body);
  let items: TitleMeta[] = r.results.slice(skip, skip + limit).map((x: any) => toMeta(x.record));
  if (f.yearFrom && f.yearFrom !== f.yearTo) items = items.filter((i) => !i.year || i.year >= f.yearFrom!);
  if (f.yearTo && f.yearFrom !== f.yearTo) items = items.filter((i) => !i.year || i.year <= f.yearTo!);
  if (f.minRating) items = items.filter((i) => (i.rating ?? 0) >= f.minRating!);
  if (f.status?.length) items = items.filter((i) => !i.status || f.status!.includes(i.status));
  return { items, total: r.total_hits ?? null, hasMore: offset + limit < (r.total_hits ?? 0) };
}

export const mangaupdates: SourceProvider = {
  id: 'mangaupdates',
  name: 'MangaUpdates',
  description: 'Series information, ratings and licensing from MangaUpdates — including links to where each series is officially published.',
  website: 'https://www.mangaupdates.com',
  kind: 'metadata',
  capabilities: {
    search: true, chapters: false, download: false, novels: true,
    discover: ['popular', 'top_rated', 'new', 'novels', 'most_followed'],
    filters: ['query', 'types', 'genres', 'excludeGenres', 'yearFrom', 'yearTo', 'status', 'minRating', 'contentRating', 'sort'],
  },
  async genres() {
    const r = await mu<any[]>('/genres', undefined, 24 * 3600_000);
    const hide = new Set([...NEVER, ...ADULT, 'Doujinshi', 'Shounen', 'Shoujo', 'Seinen', 'Josei']);
    return r.map((g) => g.genre).filter((g) => !hide.has(g));
  },
  search: (f) => search(f),
  discover(section: DiscoverSection, o) {
    const base = { limit: o.limit, offset: o.offset, contentRating: o.contentRating };
    switch (section) {
      case 'top_rated': return search({ ...base, sort: 'rating' });
      case 'new': return search({ ...base, sort: 'newest' });
      case 'novels': return search({ ...base, types: ['novel'], sort: 'popular' });
      default: return search({ ...base, sort: 'popular' });
    }
  },
  async getTitle(sourceId) {
    if (!/^\d+$/.test(sourceId)) throw new SourceError('mangaupdates', 'Invalid MangaUpdates id', 400);
    return toMeta(await mu(`/series/${sourceId}`));
  },
  async getChapters() {
    return [];
  },
  async getPages() {
    throw new SourceError('mangaupdates', 'MangaUpdates provides information only — use “Read officially” or a reading source.', 400);
  },
  async related(sourceId) {
    if (!/^\d+$/.test(sourceId)) return [];
    const r = await mu(`/series/${sourceId}`);
    const recs = [...(r.recommendations ?? []), ...(r.category_recommendations ?? [])].slice(0, 16);
    // Recommendation entries are summaries; turn them into minimal title records.
    return recs.map((x: any): TitleMeta => ({
      sourceId: String(x.series_id), type: 'manga', title: x.series_name,
      coverUrl: x.series_image?.url?.original ?? null, links: slugOf(x.series_url) ? { mu: slugOf(x.series_url)! } : {},
    }));
  },
  allowsImageHost: (host) => host === 'cdn.mangaupdates.com',
};
