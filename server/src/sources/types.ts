/**
 * Source-provider contract. Every catalog (MangaDex, AniList, the local library, future licensed
 * providers) implements this interface. The rest of the app never talks to an upstream directly.
 *
 * Rules for provider authors:
 *  - Use only official/public APIs or content you have rights to serve. No scraping that violates
 *    a site's terms, no bypassing access controls or DRM.
 *  - Set `downloadable` only when the source permits offline copies.
 *  - Throw `SourceError` with a human-readable message on failure; callers render it.
 */
export type ContentType = 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'novel';
export const CONTENT_TYPES: ContentType[] = ['manga', 'manhwa', 'manhua', 'webtoon', 'novel'];

export type DiscoverSection = 'trending' | 'popular' | 'latest' | 'new' | 'top_rated' | 'most_followed' | 'seasonal' | 'novels';

export interface TitleMeta {
  sourceId: string;
  type: ContentType;
  title: string;
  altTitles?: string[];
  description?: string;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  authors?: string[];
  artists?: string[];
  genres?: string[];
  tags?: string[];
  demographic?: string | null;
  status?: string | null; // ongoing | completed | hiatus | cancelled
  year?: number | null;
  contentRating?: string | null; // safe | suggestive | erotica | pornographic
  languages?: string[];
  originalLanguage?: string | null;
  rating?: number | null; // normalized to 0–10
  follows?: number | null;
  links?: Record<string, string>; // al, mal, mu, raw, official...
  chapterCount?: number | null;
}

export interface ChapterMeta {
  sourceChapterId: string;
  number: number | null;
  numberLabel?: string | null;
  volume?: string | null;
  name?: string | null;
  language?: string | null;
  group?: string | null;
  pages?: number | null;
  publishedAt?: string | null;
  externalUrl?: string | null; // chapter is hosted elsewhere (official site); open externally
  downloadable?: boolean;
}

export type PageData =
  | { kind: 'images'; pages: { url: string; fallbackUrl?: string; width?: number; height?: number }[] }
  | { kind: 'text'; html: string }
  | { kind: 'external'; url: string };

export type SortKey = 'relevance' | 'popular' | 'rating' | 'latest' | 'newest' | 'title' | 'follows';

export interface SearchFilters {
  query?: string;
  types?: ContentType[];
  genres?: string[];
  excludeGenres?: string[];
  demographic?: string[];
  status?: string[];
  yearFrom?: number;
  yearTo?: number;
  language?: string; // available translated language
  contentRating?: string[];
  author?: string;
  minRating?: number;
  sort?: SortKey;
  limit: number;
  offset: number;
}

export interface SearchResult {
  items: TitleMeta[];
  total: number | null;
  hasMore: boolean;
}

export interface SourceProvider {
  id: string;
  name: string;
  description: string;
  website?: string;
  /** content providers can serve chapters; metadata providers only describe titles. */
  kind: 'content' | 'metadata';
  capabilities: {
    search: boolean;
    chapters: boolean;
    download: boolean;
    novels: boolean;
    discover: DiscoverSection[];
    filters: (keyof SearchFilters)[];
  };
  genres(): Promise<string[]>;
  search(f: SearchFilters): Promise<SearchResult>;
  discover(section: DiscoverSection, opts: { limit: number; offset: number; language?: string; contentRating?: string[] }): Promise<SearchResult>;
  getTitle(sourceId: string): Promise<TitleMeta>;
  getChapters(sourceId: string, opts: { languages?: string[] }): Promise<ChapterMeta[]>;
  getPages(sourceChapterId: string, opts: { dataSaver?: boolean }): Promise<PageData>;
  related?(sourceId: string): Promise<TitleMeta[]>;
  /** Hosts whose images the server may proxy/cache for this provider. */
  allowsImageHost(host: string): boolean;
}

export class SourceError extends Error {
  constructor(public source: string, message: string, public status = 502) {
    super(message);
  }
}
