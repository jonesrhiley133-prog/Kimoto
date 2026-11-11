import type { ContentType, Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  reading: 'Reading', completed: 'Completed', planning: 'Plan to Read', on_hold: 'On Hold', dropped: 'Dropped', rereading: 'Re-reading',
};
export const STATUS_ORDER: Status[] = ['reading', 'rereading', 'planning', 'on_hold', 'completed', 'dropped'];
export const TYPE_LABEL: Record<ContentType, string> = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', webtoon: 'Webtoon', novel: 'Light Novel' };
export const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  const units: [number, string][] = [[60, 'm'], [3600, 'h'], [86400, 'd'], [604800, 'w'], [2629800, 'mo'], [31557600, 'y']];
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  if (s < 2629800) return `${Math.round(s / 604800)}w ago`;
  if (s < 31557600) return `${Math.round(s / 2629800)}mo ago`;
  void units;
  return `${Math.round(s / 31557600)}y ago`;
}

export function duration(sec: number, short = false) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 100) return `${h.toLocaleString()}h`;
  if (h) return short ? `${h}h ${m}m` : `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

export const num = (n: number | null | undefined) => (n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString());
export const bytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);

export function chapterLabel(c: { numberLabel?: string | null; number?: number | null; volume?: string | null; name?: string | null } | null | undefined, withName = true) {
  if (!c) return '';
  const n = c.numberLabel ?? (c.number != null ? String(c.number) : null);
  const base = `${c.volume ? `Vol. ${c.volume} ` : ''}${n != null ? `Ch. ${n}` : 'Oneshot'}`;
  return withName && c.name ? `${base} — ${c.name}` : base;
}

export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
