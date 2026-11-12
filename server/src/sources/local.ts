import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { ChapterMeta, ContentType, DiscoverSection, PageData, SearchFilters, SearchResult, SourceProvider, TitleMeta } from './types.js';
import { SourceError } from './types.js';

/**
 * Local library provider: serves content you own from LOCAL_LIBRARY_DIR (default data/library).
 *
 *   <library>/<series-folder>/series.json   optional metadata (see docs/SOURCES.md)
 *   <library>/<series-folder>/cover.jpg     optional cover (jpg/png/webp/svg)
 *   <library>/<series-folder>/<chapter>/    a folder of page images, sorted naturally
 *   <library>/<series-folder>/<chapter>.md  a light novel chapter (.md, .txt or .html)
 */
const IMG = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const TEXT = /\.(md|txt|html?)$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const root = () => config.libraryDir;

export function safeJoin(...parts: string[]) {
  const p = path.resolve(root(), ...parts);
  if (p !== root() && !p.startsWith(root() + path.sep)) throw new SourceError('local', 'Invalid path', 400);
  return p;
}

interface SeriesJson {
  title?: string; type?: ContentType; description?: string; altTitles?: string[]; authors?: string[]; artists?: string[];
  genres?: string[]; tags?: string[]; status?: string; year?: number; demographic?: string; language?: string;
  contentRating?: string; links?: Record<string, string>;
}

function readSeries(dir: string): TitleMeta | null {
  const full = safeJoin(dir);
  if (!fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) return null;
  let meta: SeriesJson = {};
  const metaFile = path.join(full, 'series.json');
  if (fs.existsSync(metaFile)) {
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* ignore malformed metadata */ }
  }
  const entries = fs.readdirSync(full);
  const cover = entries.find((e) => /^cover\.(jpe?g|png|webp|svg)$/i.test(e));
  const chapters = listChapters(dir);
  const isNovel = meta.type === 'novel' || (chapters.length > 0 && chapters.every((c) => TEXT.test(c)));
  return {
    sourceId: dir,
    type: meta.type ?? (isNovel ? 'novel' : 'manga'),
    title: meta.title ?? dir.replace(/[-_]+/g, ' '),
    altTitles: meta.altTitles ?? [],
    description: meta.description ?? '',
    coverUrl: cover ? fileUrl(dir, cover) : null,
    authors: meta.authors ?? [], artists: meta.artists ?? [],
    genres: meta.genres ?? [], tags: meta.tags ?? [],
    demographic: meta.demographic ?? null, status: meta.status ?? null, year: meta.year ?? null,
    contentRating: meta.contentRating ?? 'safe',
    languages: [meta.language ?? 'en'], originalLanguage: meta.language ?? 'en',
    rating: null, follows: null, links: meta.links ?? {}, chapterCount: chapters.length,
  };
}

function listChapters(dir: string): string[] {
  const full = safeJoin(dir);
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && ((e.isDirectory()) || (e.isFile() && TEXT.test(e.name) && e.name !== 'series.json')))
    .map((e) => e.name)
    .sort(collator.compare);
}

export const fileUrl = (...parts: string[]) => `/api/sources/local/file/${parts.map(encodeURIComponent).join('/')}`;

function parseChapter(name: string, i: number) {
  const base = name.replace(TEXT, '');
  const vol = base.match(/vol(?:ume)?\.?\s*(\d+)/i)?.[1] ?? null;
  const num = base.replace(/vol(?:ume)?\.?\s*\d+/i, '').match(/(?:ch(?:apter)?\.?\s*)?(\d+(?:\.\d+)?)/i)?.[1];
  const title = base.split(/\s+-\s+/).slice(1).join(' - ') || null;
  return { number: num ? Number(num) : i + 1, volume: vol, name: title };
}

/** Minimal, safe Markdown → HTML (escapes everything first). */
export function renderText(src: string, kind: 'md' | 'txt' | 'html'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (kind === 'html') src = src.replace(/<[^>]+>/g, (t) => (/^<\/?(p|br|h[1-4]|em|strong|i|b|hr)\b/i.test(t) ? `\u0000${t}\u0001` : ''));
  const blocks = src.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks.map((b) => {
    let t = esc(b.trim()).replace(/\u0000(.*?)\u0001/g, (_m, tag) => tag.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
    if (!t) return '';
    if (kind === 'html') return t;
    if (kind === 'md') {
      const hm = t.match(/^(#{1,4})\s+(.*)$/);
      if (hm) return `<h${hm[1].length + 1}>${hm[2]}</h${hm[1].length + 1}>`;
      if (/^(\*\s*){3,}$|^-{3,}$/.test(t)) return '<hr/>';
      t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>');
    }
    return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');
}

function allSeries(): TitleMeta[] {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => readSeries(e.name))
    .filter((x): x is TitleMeta => !!x);
}

function filterSort(items: TitleMeta[], f: Partial<SearchFilters>): TitleMeta[] {
  const qy = f.query?.toLowerCase();
  let out = items.filter((t) =>
    (!qy || t.title.toLowerCase().includes(qy) || t.altTitles?.some((a) => a.toLowerCase().includes(qy)) || t.authors?.some((a) => a.toLowerCase().includes(qy))) &&
    (!f.types?.length || f.types.includes(t.type)) &&
    (!f.genres?.length || f.genres.every((g) => t.genres?.some((x) => x.toLowerCase() === g.toLowerCase()))) &&
    (!f.excludeGenres?.length || !f.excludeGenres.some((g) => t.genres?.some((x) => x.toLowerCase() === g.toLowerCase()))) &&
    (!f.status?.length || (t.status && f.status.includes(t.status))) &&
    (!f.demographic?.length || (t.demographic && f.demographic.includes(t.demographic))) &&
    (!f.yearFrom || (t.year ?? 0) >= f.yearFrom) && (!f.yearTo || (t.year ?? 9999) <= f.yearTo) &&
    (!f.author || [...(t.authors ?? []), ...(t.artists ?? [])].some((a) => a.toLowerCase().includes(f.author!.toLowerCase()))));
  if (f.sort === 'newest') out = out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else out = out.sort((a, b) => collator.compare(a.title, b.title));
  return out;
}

export const local: SourceProvider = {
  id: 'local',
  name: 'Local Library',
  description: 'Manga, comics and novels you own, served from a folder on the server. Always works offline.',
  kind: 'content',
  capabilities: {
    search: true, chapters: true, download: true, novels: true,
    discover: ['latest', 'popular', 'novels', 'new'],
    filters: ['query', 'types', 'genres', 'excludeGenres', 'status', 'demographic', 'yearFrom', 'yearTo', 'author', 'sort'],
  },
  async genres() {
    return [...new Set(allSeries().flatMap((s) => s.genres ?? []))].sort();
  },
  async search(f): Promise<SearchResult> {
    const all = filterSort(allSeries(), f);
    return { items: all.slice(f.offset, f.offset + f.limit), total: all.length, hasMore: f.offset + f.limit < all.length };
  },
  async discover(section: DiscoverSection, o) {
    let all = allSeries();
    if (section === 'novels') all = all.filter((s) => s.type === 'novel');
    if (section === 'latest') {
      const mtime = (s: TitleMeta) => fs.statSync(safeJoin(s.sourceId)).mtimeMs;
      all.sort((a, b) => mtime(b) - mtime(a));
    }
    return { items: all.slice(o.offset, o.offset + o.limit), total: all.length, hasMore: o.offset + o.limit < all.length };
  },
  async getTitle(sourceId) {
    const t = readSeries(sourceId);
    if (!t) throw new SourceError('local', 'That series is no longer in the local library.', 404);
    return t;
  },
  async getChapters(sourceId): Promise<ChapterMeta[]> {
    const dir = safeJoin(sourceId);
    if (!fs.existsSync(dir)) throw new SourceError('local', 'That series is no longer in the local library.', 404);
    return listChapters(sourceId).map((name, i) => {
      const p = parseChapter(name, i);
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      const pages = st.isDirectory() ? fs.readdirSync(full).filter((f) => IMG.test(f)).length : null;
      return {
        sourceChapterId: `${sourceId}/${name}`, number: p.number, numberLabel: String(p.number), volume: p.volume, name: p.name,
        language: 'en', group: null, pages, publishedAt: st.mtime.toISOString(), externalUrl: null, downloadable: true,
      };
    }).reverse();
  },
  async getPages(sourceChapterId): Promise<PageData> {
    const [series, ...rest] = sourceChapterId.split('/');
    const name = rest.join('/');
    const full = safeJoin(series, name);
    const st = fs.statSync(full, { throwIfNoEntry: false });
    if (!st) throw new SourceError('local', 'Chapter not found in the local library.', 404);
    if (st.isDirectory()) {
      const files = fs.readdirSync(full).filter((f) => IMG.test(f)).sort(collator.compare);
      return { kind: 'images', pages: files.map((f) => ({ url: fileUrl(series, name, f) })) };
    }
    const ext = path.extname(full).slice(1).toLowerCase();
    const kind = ext === 'md' ? 'md' : ext.startsWith('htm') ? 'html' : 'txt';
    return { kind: 'text', html: renderText(fs.readFileSync(full, 'utf8'), kind) };
  },
  async related(sourceId) {
    const me = readSeries(sourceId);
    if (!me) return [];
    return allSeries().filter((s) => s.sourceId !== sourceId && s.genres?.some((g) => me.genres?.includes(g))).slice(0, 12);
  },
  allowsImageHost: () => false,
};
