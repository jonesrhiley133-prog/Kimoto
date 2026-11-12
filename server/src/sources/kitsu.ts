import { config } from '../config.js';
import { TTLCache, timeoutFetch } from '../lib/util.js';
import type { ContentType, DiscoverSection, SearchFilters, SearchResult, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';

/**
 * Kitsu — official public JSON:API, https://kitsu.docs.apiary.io.
 *
 * A metadata catalog for manga, manhwa, manhua and light novels. Each title's mappings link it to
 * MyAnimeList, AniList and MangaUpdates, so Kitsu titles sync with trackers and can be matched to
 * readable copies on Kimoto's content sources.
 */
const API = 'https://kitsu.app/api/edge';
const cache = new TTLCache<any>(15 * 60_000, 1500);
const PAGE_MAX = 20; // Kitsu's maximum page size

async function kitsu<T = any>(path: string, params: Record<string, string> = {}, ttl?: number): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${API}${path}${qs ? `?${qs}` : ''}`;
  return cache.wrap(url, async () => {
    let res: Response;
    try {
      res = await timeoutFetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/vnd.api+json' } });
    } catch {
      throw new SourceError('kitsu', 'Kitsu is unreachable right now.');
    }
    if (res.status === 404) throw new SourceError('kitsu', 'Not found on Kitsu.', 404);
    if (res.status === 429) throw new SourceError('kitsu', 'Kitsu rate limit reached — try again in a minute.', 429);
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j || j.errors) throw new SourceError('kitsu', j?.errors?.[0]?.detail ?? `Kitsu error (${res.status})`);
    return j as T;
  }, ttl);
}

const TYPE_OF: Record<string, ContentType> = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', novel: 'novel', oel: 'manga', oneshot: 'manga' };
const SUBTYPES: Record<ContentType, string[]> = { manga: ['manga', 'oneshot', 'oel'], manhwa: ['manhwa'], manhua: ['manhua'], webtoon: ['manhwa'], novel: ['novel'] };
const DEFAULT_SUBTYPES = ['manga', 'manhwa', 'manhua', 'novel', 'oel', 'oneshot']; // skips doujin
const STATUS: Record<string, string> = { current: 'ongoing', finished: 'completed', tba: 'upcoming', unreleased: 'upcoming', upcoming: 'upcoming' };
const STATUS_FILTER: Record<string, string> = { ongoing: 'current', completed: 'finished', upcoming: 'upcoming' };
const DEMOGRAPHICS = ['shounen', 'shoujo', 'seinen', 'josei'];
const SITE_KEY: Record<string, string> = { 'myanimelist/manga': 'mal', 'anilist/manga': 'al', mangaupdates: 'mu' };

/** Kitsu has no age filter for manga, so 18+ entries are dropped here unless the user allows them. */
const allowedRating = (ageRating: string | null, contentRating?: string[]) =>
  ageRating !== 'R18' || !!contentRating?.some((r) => r === 'erotica' || r === 'pornographic');

function toMeta(d: any, included: any[] = []): TitleMeta {
  const a = d.attributes;
  const rel = (name: string) => {
    const ids = new Set((d.relationships?.[name]?.data ?? []).map((x: any) => `${x.type}:${x.id}`));
    return included.filter((i) => ids.has(`${i.type}:${i.id}`));
  };
  const categories: string[] = rel('categories').map((c: any) => c.attributes.title);
  const links: Record<string, string> = {};
  for (const m of rel('mappings')) {
    const key = SITE_KEY[m.attributes.externalSite];
    if (key && !links[key]) links[key] = String(m.attributes.externalId);
  }
  const titles = Object.values(a.titles ?? {}).filter(Boolean) as string[];
  return {
    sourceId: String(d.id),
    type: TYPE_OF[a.subtype] ?? 'manga',
    title: a.titles?.en || a.canonicalTitle,
    altTitles: [...new Set([a.canonicalTitle, ...titles, ...(a.abbreviatedTitles ?? [])])].filter((t) => t && t !== (a.titles?.en || a.canonicalTitle)).slice(0, 20),
    description: a.synopsis ?? a.description ?? '',
    coverUrl: a.posterImage?.large ?? a.posterImage?.original ?? a.posterImage?.medium ?? null,
    bannerUrl: a.coverImage?.large ?? a.coverImage?.original ?? null,
    authors: [],
    artists: [],
    genres: categories.filter((c) => !DEMOGRAPHICS.includes(c.toLowerCase())),
    tags: a.serialization ? [a.serialization] : [],
    demographic: categories.map((c) => c.toLowerCase()).find((c) => DEMOGRAPHICS.includes(c)) ?? null,
    status: STATUS[a.status] ?? null,
    year: a.startDate ? Number(String(a.startDate).slice(0, 4)) : null,
    contentRating: a.ageRating === 'R18' ? 'erotica' : a.ageRating === 'R' ? 'suggestive' : 'safe',
    languages: [],
    rating: a.averageRating ? Number(a.averageRating) / 10 : null,
    follows: a.userCount ?? null,
    links,
    chapterCount: a.chapterCount ?? null,
  };
}

const SORT: Record<string, string> = { popular: '-userCount', follows: '-favoritesCount', rating: '-averageRating', newest: '-startDate', latest: '-updatedAt', title: 'canonicalTitle' };

async function list(f: Partial<SearchFilters> & { path?: string }): Promise<SearchResult> {
  const limit = Math.min(f.limit ?? PAGE_MAX, PAGE_MAX);
  const p: Record<string, string> = { 'page[limit]': String(limit), 'page[offset]': String(f.offset ?? 0), include: 'categories,mappings' };
  p['filter[subtype]'] = (f.types?.length ? [...new Set(f.types.flatMap((t) => SUBTYPES[t]))] : DEFAULT_SUBTYPES).join(',');
  if (f.query) p['filter[text]'] = f.query; // Kitsu orders text searches by relevance and ignores `sort`
  else p.sort = SORT[f.sort ?? 'popular'] ?? '-userCount';
  if (f.genres?.length) p['filter[categories]'] = f.genres.map((g) => g.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join(',');
  if (f.status?.length) p['filter[status]'] = f.status.map((s) => STATUS_FILTER[s]).filter(Boolean).join(',');
  if (f.yearFrom || f.yearTo) p['filter[year]'] = `${f.yearFrom ?? 1900}..${f.yearTo ?? new Date().getFullYear() + 1}`;
  const r = await kitsu('/manga', p);
  let items: TitleMeta[] = r.data.filter((d: any) => allowedRating(d.attributes.ageRating, f.contentRating)).map((d: any) => toMeta(d, r.included));
  if (f.excludeGenres?.length) {
    const ex = new Set(f.excludeGenres.map((g) => g.toLowerCase()));
    items = items.filter((i) => !i.genres?.some((g) => ex.has(g.toLowerCase())));
  }
  if (f.minRating) items = items.filter((i) => (i.rating ?? 0) >= f.minRating!);
  return { items, total: r.meta?.count ?? null, hasMore: !!r.links?.next };
}

export const kitsu_: SourceProvider = {
  id: 'kitsu',
  name: 'Kitsu',
  description: 'Manga, manhwa, manhua and light novel catalog from Kitsu, linked to MyAnimeList, AniList and MangaUpdates.',
  website: 'https://kitsu.app',
  kind: 'metadata',
  capabilities: {
    search: true, chapters: false, download: false, novels: true,
    discover: ['trending', 'popular', 'top_rated', 'new', 'novels', 'most_followed'],
    filters: ['query', 'types', 'genres', 'excludeGenres', 'status', 'yearFrom', 'yearTo', 'minRating', 'contentRating', 'sort'],
  },
  async genres() {
    const r = await kitsu('/categories', { 'page[limit]': String(PAGE_MAX), sort: '-totalMediaCount' }, 24 * 3600_000);
    return r.data.map((c: any) => c.attributes.title).filter((t: string) => !DEMOGRAPHICS.includes(t.toLowerCase())).sort();
  },
  search: (f) => list(f),
  async discover(section: DiscoverSection, o) {
    const base = { limit: o.limit, offset: o.offset, contentRating: o.contentRating };
    switch (section) {
      case 'trending': {
        // /trending/manga has no paging; serve it for the first page, then fall back to popularity.
        if (o.offset > 0) return list({ ...base, sort: 'popular' });
        const r = await kitsu('/trending/manga', { limit: String(Math.min(o.limit, PAGE_MAX)) }, 30 * 60_000);
        const items = r.data.filter((d: any) => allowedRating(d.attributes.ageRating, o.contentRating)).map((d: any) => toMeta(d));
        return { items, total: null, hasMore: true };
      }
      case 'top_rated': return list({ ...base, sort: 'rating' });
      case 'new': return list({ ...base, sort: 'newest', status: ['ongoing'] });
      case 'novels': return list({ ...base, types: ['novel'], sort: 'popular' });
      case 'most_followed': return list({ ...base, sort: 'follows' });
      default: return list({ ...base, sort: 'popular' });
    }
  },
  async getTitle(sourceId) {
    if (!/^\d+$/.test(sourceId)) throw new SourceError('kitsu', 'Invalid Kitsu id', 400);
    const r = await kitsu(`/manga/${sourceId}`, { include: 'categories,mappings' });
    return toMeta(r.data, r.included);
  },
  async getChapters() {
    return [];
  },
  async getPages() {
    throw new SourceError('kitsu', 'Kitsu provides information only — pick a reading source on the title page.', 400);
  },
  async related(sourceId) {
    if (!/^\d+$/.test(sourceId)) return [];
    const r = await kitsu(`/manga/${sourceId}/media-relationships`, { include: 'destination', 'page[limit]': String(PAGE_MAX) }).catch(() => null);
    if (!r) return [];
    return (r.included ?? []).filter((i: any) => i.type === 'manga').map((d: any) => toMeta(d));
  },
  allowsImageHost: (host) => host === 'media.kitsu.app' || host === 'media.kitsu.io',
};
