import { config } from '../config.js';
import { TTLCache, timeoutFetch, sleep } from '../lib/util.js';
import type { ChapterMeta, ContentType, DiscoverSection, PageData, SearchFilters, SearchResult, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';

/**
 * MangaDex provider using the official public API (https://api.mangadex.org/docs).
 * Follows the API's guidance: identifies itself with a User-Agent, stays under the rate limit,
 * credits scanlation groups, and links out for externally-hosted (official) chapters.
 */
const API = 'https://api.mangadex.org';
const cache = new TTLCache<any>(5 * 60_000, 2000);
const DEFAULT_RATINGS = ['safe', 'suggestive'];

// Serialize requests to stay well below MangaDex's ~5 req/s global limit.
let chain: Promise<unknown> = Promise.resolve();
let last = 0;
function md<T = any>(path: string, params?: URLSearchParams, ttl?: number): Promise<T> {
  const url = `${API}${path}${params && [...params].length ? `?${params}` : ''}`;
  return cache.wrap(url, () => {
    const p = chain.then(async () => {
      const wait = 250 - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res: Response;
      try {
        res = await timeoutFetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' } });
      } catch {
        throw new SourceError('mangadex', 'MangaDex is unreachable right now. Check your connection or try again shortly.');
      }
      if (res.status === 404) throw new SourceError('mangadex', 'Not found on MangaDex.', 404);
      if (res.status === 429) throw new SourceError('mangadex', 'MangaDex rate limit reached — try again in a minute.', 429);
      if (!res.ok) throw new SourceError('mangadex', `MangaDex returned an error (${res.status}).`);
      return res.json() as Promise<T>;
    });
    chain = p.catch(() => undefined);
    return p;
  }, ttl);
}

let tagMap: Promise<Map<string, { id: string; group: string }>> | null = null;
function tags() {
  tagMap ??= md('/manga/tag', undefined, 24 * 3600_000).then((r: any) => {
    const m = new Map<string, { id: string; group: string }>();
    for (const t of r.data) m.set(String(t.attributes.name.en).toLowerCase(), { id: t.id, group: t.attributes.group });
    return m;
  }).catch((e) => {
    tagMap = null;
    throw e;
  });
  return tagMap;
}

const pick = (o: Record<string, string> | undefined) => (o ? o.en ?? o['ja-ro'] ?? o.ja ?? Object.values(o)[0] ?? '' : '');

function typeOf(a: any): ContentType {
  const lang = a.originalLanguage as string;
  const longStrip = (a.tags ?? []).some((t: any) => t.attributes?.name?.en === 'Long Strip');
  if (lang === 'ko') return longStrip ? 'webtoon' : 'manhwa';
  if (lang?.startsWith('zh')) return 'manhua';
  if (longStrip && lang !== 'ja') return 'webtoon';
  return 'manga';
}

function toMeta(m: any, stats?: any): TitleMeta {
  const a = m.attributes;
  const rel = (type: string) => (m.relationships ?? []).filter((r: any) => r.type === type);
  const cover = rel('cover_art')[0]?.attributes?.fileName;
  const tagList = (a.tags ?? []).map((t: any) => ({ name: t.attributes.name.en as string, group: t.attributes.group as string }));
  const s = stats?.[m.id];
  return {
    sourceId: m.id,
    type: typeOf(a),
    title: pick(a.title),
    altTitles: (a.altTitles ?? []).map((t: any) => Object.values(t)[0] as string).slice(0, 20),
    description: pick(a.description),
    coverUrl: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg` : null,
    authors: rel('author').map((r: any) => r.attributes?.name).filter(Boolean),
    artists: rel('artist').map((r: any) => r.attributes?.name).filter(Boolean),
    genres: tagList.filter((t: any) => t.group === 'genre').map((t: any) => t.name),
    tags: tagList.filter((t: any) => t.group !== 'genre').map((t: any) => t.name),
    demographic: a.publicationDemographic ?? null,
    status: a.status ?? null,
    year: a.year ?? null,
    contentRating: a.contentRating ?? null,
    languages: a.availableTranslatedLanguages ?? [],
    originalLanguage: a.originalLanguage ?? null,
    rating: s?.rating?.bayesian ?? null,
    follows: s?.follows ?? null,
    links: Object.fromEntries(Object.entries(a.links ?? {}).map(([k, v]) => [k, String(v)])),
    chapterCount: a.lastChapter ? Number(a.lastChapter) || null : null,
  };
}

async function withStats(data: any[]): Promise<TitleMeta[]> {
  if (!data.length) return [];
  const p = new URLSearchParams();
  data.forEach((m) => p.append('manga[]', m.id));
  const stats = await md('/statistics/manga', p, 30 * 60_000).then((r: any) => r.statistics).catch(() => ({}));
  return data.map((m) => toMeta(m, stats));
}

const ORDER: Record<string, [string, string]> = {
  relevance: ['relevance', 'desc'], popular: ['followedCount', 'desc'], follows: ['followedCount', 'desc'],
  rating: ['rating', 'desc'], latest: ['latestUploadedChapter', 'desc'], newest: ['createdAt', 'desc'], title: ['title', 'asc'],
};
const LANG_FOR_TYPE: Record<string, string[]> = { manga: ['ja'], manhwa: ['ko'], manhua: ['zh', 'zh-hk'], webtoon: ['ko', 'zh', 'en'] };

async function listManga(f: Partial<SearchFilters>): Promise<SearchResult> {
  const p = new URLSearchParams();
  p.set('limit', String(Math.min(f.limit ?? 24, 100)));
  p.set('offset', String(f.offset ?? 0));
  ['cover_art', 'author', 'artist'].forEach((i) => p.append('includes[]', i));
  (f.contentRating?.length ? f.contentRating : DEFAULT_RATINGS).forEach((r) => p.append('contentRating[]', r));
  if (f.query) p.set('title', f.query);
  if (f.language) p.append('availableTranslatedLanguage[]', f.language);
  const types = (f.types ?? []).filter((t) => t !== 'novel');
  if (f.types?.length && !types.length) return { items: [], total: 0, hasMore: false }; // MangaDex has no novels
  new Set(types.flatMap((t) => LANG_FOR_TYPE[t] ?? [])).forEach((l) => p.append('originalLanguage[]', l));
  if (types.length === 1 && types[0] === 'webtoon') {
    const ls = (await tags()).get('long strip');
    if (ls) p.append('includedTags[]', ls.id);
  }
  f.demographic?.forEach((d) => p.append('publicationDemographic[]', d));
  f.status?.forEach((s) => p.append('status[]', s));
  if (f.yearFrom && f.yearFrom === f.yearTo) p.set('year', String(f.yearFrom));
  if (f.genres?.length || f.excludeGenres?.length) {
    const m = await tags();
    f.genres?.forEach((g) => { const t = m.get(g.toLowerCase()); if (t) p.append('includedTags[]', t.id); });
    f.excludeGenres?.forEach((g) => { const t = m.get(g.toLowerCase()); if (t) p.append('excludedTags[]', t.id); });
  }
  if (f.author) {
    const ar = await md('/author', new URLSearchParams({ name: f.author, limit: '5' })).catch(() => ({ data: [] }));
    if (!ar.data.length) return { items: [], total: 0, hasMore: false };
    ar.data.forEach((a: any) => p.append('authorOrArtist', a.id));
  }
  const sort = f.sort ?? (f.query ? 'relevance' : 'popular');
  const [k, dir] = ORDER[sort] ?? ORDER.popular;
  if (k !== 'relevance' || f.query) p.set(`order[${k}]`, dir);
  const r = await md('/manga', p);
  let items = await withStats(r.data);
  if (f.yearFrom && f.yearFrom !== f.yearTo) items = items.filter((i) => !i.year || i.year >= f.yearFrom!);
  if (f.yearTo && f.yearFrom !== f.yearTo) items = items.filter((i) => !i.year || i.year <= f.yearTo!);
  if (f.minRating) items = items.filter((i) => (i.rating ?? 0) >= f.minRating!);
  return { items, total: r.total, hasMore: r.offset + r.limit < r.total };
}

export const mangadex: SourceProvider = {
  id: 'mangadex',
  name: 'MangaDex',
  description: 'Scanlation catalog via the official MangaDex API. Chapters credit their scanlation groups.',
  website: 'https://mangadex.org',
  kind: 'content',
  capabilities: {
    search: true, chapters: true, download: true, novels: false,
    discover: ['popular', 'latest', 'new', 'top_rated', 'most_followed', 'trending'],
    filters: ['query', 'types', 'genres', 'excludeGenres', 'demographic', 'status', 'yearFrom', 'yearTo', 'language', 'contentRating', 'author', 'minRating', 'sort'],
  },
  async genres() {
    const m = await tags();
    return [...m.entries()].filter(([, v]) => v.group === 'genre' || v.group === 'theme').map(([k]) => k.replace(/\b\w/g, (c) => c.toUpperCase())).sort();
  },
  search: (f) => listManga(f),
  discover(section: DiscoverSection, o) {
    const base = { limit: o.limit, offset: o.offset, language: o.language, contentRating: o.contentRating };
    switch (section) {
      case 'latest': return listManga({ ...base, sort: 'latest' });
      case 'new': return listManga({ ...base, sort: 'newest' });
      case 'top_rated': return listManga({ ...base, sort: 'rating' });
      case 'trending': {
        // "Trending" approximated as most-followed among titles with recent uploads.
        return listManga({ ...base, sort: 'latest', limit: 100 }).then((r) => ({
          ...r, items: [...r.items].sort((a, b) => (b.follows ?? 0) - (a.follows ?? 0)).slice(0, o.limit),
        }));
      }
      default: return listManga({ ...base, sort: 'popular' });
    }
  },
  async getTitle(sourceId) {
    const p = new URLSearchParams();
    ['cover_art', 'author', 'artist'].forEach((i) => p.append('includes[]', i));
    const r = await md(`/manga/${encodeURIComponent(sourceId)}`, p);
    return (await withStats([r.data]))[0];
  },
  async getChapters(sourceId, { languages }) {
    const out: ChapterMeta[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const p = new URLSearchParams({ limit: '500', offset: String(offset), 'order[chapter]': 'desc', 'order[volume]': 'desc' });
      (languages?.length ? languages : ['en']).forEach((l) => p.append('translatedLanguage[]', l));
      ['safe', 'suggestive', 'erotica', 'pornographic'].forEach((r) => p.append('contentRating[]', r));
      p.append('includes[]', 'scanlation_group');
      const r = await md(`/manga/${encodeURIComponent(sourceId)}/feed`, p, 10 * 60_000);
      for (const c of r.data) {
        const a = c.attributes;
        out.push({
          sourceChapterId: c.id,
          number: a.chapter != null && a.chapter !== '' ? Number(a.chapter) : null,
          numberLabel: a.chapter ?? null,
          volume: a.volume ?? null,
          name: a.title || null,
          language: a.translatedLanguage,
          group: c.relationships.filter((x: any) => x.type === 'scanlation_group').map((x: any) => x.attributes?.name).filter(Boolean).join(', ') || null,
          pages: a.pages,
          publishedAt: a.readableAt ?? a.publishAt,
          externalUrl: a.externalUrl ?? null,
          downloadable: !a.externalUrl,
        });
      }
      if (r.offset + r.limit >= r.total) break;
    }
    return out;
  },
  async getPages(sourceChapterId, { dataSaver }): Promise<PageData> {
    const ch = await md(`/chapter/${encodeURIComponent(sourceChapterId)}`, undefined, 3600_000);
    if (ch.data.attributes.externalUrl) return { kind: 'external', url: ch.data.attributes.externalUrl };
    // at-home URLs expire (~15 min), so cache them only briefly.
    const r = await md(`/at-home/server/${encodeURIComponent(sourceChapterId)}`, undefined, 5 * 60_000);
    const { baseUrl, chapter } = r;
    const full = (f: string) => `${baseUrl}/data/${chapter.hash}/${f}`;
    const saver = (f: string) => `${baseUrl}/data-saver/${chapter.hash}/${f}`;
    return {
      kind: 'images',
      pages: chapter.data.map((f: string, i: number) => ({
        url: dataSaver && chapter.dataSaver[i] ? saver(chapter.dataSaver[i]) : full(f),
        fallbackUrl: chapter.dataSaver[i] ? saver(chapter.dataSaver[i]) : undefined,
      })),
    };
  },
  async related(sourceId) {
    const p = new URLSearchParams();
    p.append('includes[]', 'manga');
    const r = await md(`/manga/${encodeURIComponent(sourceId)}/relation`, p).catch(() => ({ data: [] }));
    const ids = r.data.filter((x: any) => x.relationships?.[0]?.type === 'manga').map((x: any) => x.relationships[0].id).slice(0, 20);
    if (!ids.length) return [];
    const q2 = new URLSearchParams({ limit: String(ids.length) });
    ids.forEach((i: string) => q2.append('ids[]', i));
    q2.append('includes[]', 'cover_art');
    DEFAULT_RATINGS.forEach((x) => q2.append('contentRating[]', x));
    const m = await md('/manga', q2);
    return withStats(m.data);
  },
  allowsImageHost: (host) => host === 'uploads.mangadex.org' || host.endsWith('.mangadex.network'),
};
