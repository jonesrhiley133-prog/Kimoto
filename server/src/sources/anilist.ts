import { config } from '../config.js';
import { TTLCache, timeoutFetch } from '../lib/util.js';
import type { ContentType, DiscoverSection, SearchFilters, SearchResult, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';
import { OFFICIAL_PREFIX, officialLabel } from './official.js';

/** AniList curates official reading platforms as STREAMING links (MANGA Plus, VIZ, WEBTOON…). */
function officialFromAniList(links: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of links ?? []) {
    if (l?.type !== 'STREAMING' || !/^https:\/\//.test(l.url ?? '')) continue;
    const key = `${OFFICIAL_PREFIX}${officialLabel(l.site, l.language)}`;
    if (!out[key] && Object.keys(out).length < 24) out[key] = l.url;
  }
  return out;
}

/**
 * AniList metadata provider (public GraphQL API, https://docs.anilist.co).
 * Covers manga, manhwa, manhua and light novels for discovery and details. AniList hosts no
 * chapters, so the app looks up readable copies on content providers via cross-source search.
 */
export const ANILIST_API = 'https://graphql.anilist.co';
const cache = new TTLCache<any>(10 * 60_000, 1000);

export async function anilistQuery<T = any>(query: string, variables: Record<string, unknown>, token?: string, cacheable = true): Promise<T> {
  const key = JSON.stringify([query, variables]);
  const run = async () => {
    let res: Response;
    try {
      res = await timeoutFetch(ANILIST_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': config.userAgent,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new SourceError('anilist', 'AniList is unreachable right now.');
    }
    const j: any = await res.json().catch(() => ({}));
    if (res.status === 429) throw new SourceError('anilist', 'AniList rate limit reached — try again in a minute.', 429);
    if (!res.ok || j.errors) throw new SourceError('anilist', j.errors?.[0]?.message ?? `AniList error (${res.status})`, res.status === 404 ? 404 : 502);
    return j.data as T;
  };
  return cacheable && !token ? cache.wrap(key, run) : run();
}

export const FIELDS = `
  id idMal format countryOfOrigin status startDate { year } chapters volumes averageScore popularity favourites isAdult
  title { romaji english native userPreferred } synonyms description(asHtml: false)
  coverImage { extraLarge large color } bannerImage genres tags { name rank isMediaSpoiler }
  staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
  externalLinks { url site type language }
`;

function typeOf(m: any): ContentType {
  if (m.format === 'NOVEL') return 'novel';
  if (m.countryOfOrigin === 'KR') return 'manhwa';
  if (m.countryOfOrigin === 'CN' || m.countryOfOrigin === 'TW') return 'manhua';
  return 'manga';
}
const STATUS: Record<string, string> = { RELEASING: 'ongoing', FINISHED: 'completed', HIATUS: 'hiatus', CANCELLED: 'cancelled', NOT_YET_RELEASED: 'upcoming' };
const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

export function anilistToMeta(m: any): TitleMeta {
  const staff = m.staff?.edges ?? [];
  const role = (re: RegExp) => staff.filter((e: any) => re.test(e.role)).map((e: any) => e.node.name.full);
  return {
    sourceId: String(m.id),
    type: typeOf(m),
    title: m.title.english || m.title.romaji || m.title.userPreferred,
    altTitles: [m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter((t) => t && t !== m.title.english),
    description: m.description ? stripHtml(m.description) : '',
    coverUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    bannerUrl: m.bannerImage ?? null,
    authors: role(/story|original creator|author/i),
    artists: role(/art|illustration/i),
    genres: m.genres ?? [],
    tags: (m.tags ?? []).filter((t: any) => !t.isMediaSpoiler && t.rank >= 50).map((t: any) => t.name),
    demographic: null,
    status: STATUS[m.status] ?? null,
    year: m.startDate?.year ?? null,
    contentRating: m.isAdult ? 'erotica' : 'safe',
    languages: [],
    originalLanguage: { JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh-hk' }[m.countryOfOrigin as string] ?? null,
    rating: m.averageScore != null ? m.averageScore / 10 : null,
    follows: m.popularity ?? null,
    links: { al: String(m.id), ...(m.idMal ? { mal: String(m.idMal) } : {}), ...officialFromAniList(m.externalLinks) },
    chapterCount: m.chapters ?? null,
  };
}

const SORT: Record<string, string> = {
  relevance: 'SEARCH_MATCH', popular: 'POPULARITY_DESC', follows: 'FAVOURITES_DESC', rating: 'SCORE_DESC',
  latest: 'UPDATED_AT_DESC', newest: 'START_DATE_DESC', title: 'TITLE_ROMAJI',
};

async function page(vars: Record<string, unknown>, limit: number, offset: number): Promise<SearchResult> {
  const perPage = Math.min(limit, 50);
  const pageNo = Math.floor(offset / perPage) + 1;
  const d = await anilistQuery(`query ($page:Int,$perPage:Int,$search:String,$sort:[MediaSort],$genre_in:[String],$genre_not_in:[String],$format_in:[MediaFormat],$country:CountryCode,$status_in:[MediaStatus],$startFrom:FuzzyDateInt,$startTo:FuzzyDateInt,$isAdult:Boolean,$minScore:Int) {
    Page(page:$page, perPage:$perPage) { pageInfo { total hasNextPage }
      media(type: MANGA, search:$search, sort:$sort, genre_in:$genre_in, genre_not_in:$genre_not_in, format_in:$format_in, countryOfOrigin:$country,
            status_in:$status_in, startDate_greater:$startFrom, startDate_lesser:$startTo, isAdult:$isAdult, averageScore_greater:$minScore) { ${FIELDS} } } }`,
  { page: pageNo, perPage, isAdult: false, ...vars });
  return { items: d.Page.media.map(anilistToMeta), total: d.Page.pageInfo.total, hasMore: d.Page.pageInfo.hasNextPage };
}

function filterVars(f: Partial<SearchFilters>) {
  const v: Record<string, unknown> = {};
  if (f.query) v.search = f.query;
  if (f.genres?.length) v.genre_in = f.genres;
  if (f.excludeGenres?.length) v.genre_not_in = f.excludeGenres;
  const types = f.types ?? [];
  if (types.length === 1 && types[0] === 'novel') v.format_in = ['NOVEL'];
  else if (types.length && !types.includes('novel')) v.format_in = ['MANGA', 'ONE_SHOT'];
  if (types.length === 1) {
    const c = ({ manga: 'JP', manhwa: 'KR', webtoon: 'KR', manhua: 'CN' } as Record<string, string>)[types[0]];
    if (c) v.country = c;
  }
  const st: Record<string, string> = { ongoing: 'RELEASING', completed: 'FINISHED', hiatus: 'HIATUS', cancelled: 'CANCELLED' };
  if (f.status?.length) v.status_in = f.status.map((s) => st[s]).filter(Boolean);
  if (f.yearFrom) v.startFrom = f.yearFrom * 10000;
  if (f.yearTo) v.startTo = (f.yearTo + 1) * 10000;
  if (f.minRating) v.minScore = Math.round(f.minRating * 10) - 1;
  if (f.contentRating?.some((r) => r === 'erotica' || r === 'pornographic')) delete v.isAdult;
  v.sort = [SORT[f.sort ?? (f.query ? 'relevance' : 'popular')] ?? 'POPULARITY_DESC'];
  return v;
}

export const anilist: SourceProvider = {
  id: 'anilist',
  name: 'AniList',
  description: 'Metadata, rankings and light novel catalog from AniList. Find readable copies through content sources.',
  website: 'https://anilist.co',
  kind: 'metadata',
  capabilities: {
    search: true, chapters: false, download: false, novels: true,
    discover: ['trending', 'popular', 'top_rated', 'seasonal', 'novels', 'new', 'most_followed'],
    filters: ['query', 'types', 'genres', 'excludeGenres', 'status', 'yearFrom', 'yearTo', 'minRating', 'sort', 'contentRating'],
  },
  async genres() {
    const d = await anilistQuery('{ GenreCollection }', {});
    return d.GenreCollection.filter((g: string) => g !== 'Hentai');
  },
  search: (f) => page(filterVars(f), f.limit, f.offset),
  discover(section: DiscoverSection, o) {
    const v: Record<string, unknown> = {};
    const d = new Date();
    switch (section) {
      case 'trending': v.sort = ['TRENDING_DESC']; break;
      case 'top_rated': v.sort = ['SCORE_DESC']; break;
      case 'most_followed': v.sort = ['FAVOURITES_DESC']; break;
      case 'new': v.sort = ['START_DATE_DESC']; v.status_in = ['RELEASING']; v.startTo = Number(`${d.getFullYear() + 1}0000`); break;
      case 'novels': v.sort = ['TRENDING_DESC']; v.format_in = ['NOVEL']; break;
      case 'seasonal': {
        const from = new Date(d.getFullYear(), d.getMonth() - 6, 1);
        v.sort = ['TRENDING_DESC'];
        v.startFrom = from.getFullYear() * 10000 + (from.getMonth() + 1) * 100;
        break;
      }
      default: v.sort = ['POPULARITY_DESC'];
    }
    return page(v, o.limit, o.offset);
  },
  async getTitle(sourceId) {
    const d = await anilistQuery(`query ($id:Int) { Media(id:$id, type: MANGA) { ${FIELDS} } }`, { id: Number(sourceId) });
    return anilistToMeta(d.Media);
  },
  async getChapters() {
    return [];
  },
  async getPages() {
    throw new SourceError('anilist', 'AniList provides metadata only. Pick a reading source on the title page.', 400);
  },
  async related(sourceId) {
    const d = await anilistQuery(`query ($id:Int) { Media(id:$id) {
      relations { edges { relationType node { type ${FIELDS} } } }
      recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { type ${FIELDS} } } } } }`, { id: Number(sourceId) });
    const rel = d.Media.relations.edges.filter((e: any) => e.node.type === 'MANGA').map((e: any) => e.node);
    const rec = d.Media.recommendations.nodes.map((n: any) => n.mediaRecommendation).filter((m: any) => m && m.type === 'MANGA');
    return [...rel, ...rec].map(anilistToMeta);
  },
  allowsImageHost: (host) => host === 's4.anilist.co' || host.endsWith('.anilist.co'),
};
