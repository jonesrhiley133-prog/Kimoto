import { q, json } from '../db/index.js';
import { proxied } from '../sources/registry.js';

/**
 * Reading analytics. Everything here is derived from recorded data only:
 *  - reading_sessions: active (visible, non-idle) reading time measured by the reader
 *  - chapter_reads: validated chapter completions
 *  - library_entries: statuses, completions, volumes
 */
export const RANGES: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365, all: null };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(iso: string | number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
    }
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, year: Number(p.year), hour: Number(p.hour) % 24, weekday: wd };
}

const DAYPART = (h: number) => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night');

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function streaks(activeDates: Set<string>, today: string) {
  const sorted = [...activeDates].sort();
  let longest = 0, run = 0, prev: string | null = null;
  let longestEnd: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) { longest = run; longestEnd = d; }
    prev = d;
  }
  let current = 0;
  let cursor = activeDates.has(today) ? today : addDays(today, -1); // today not read yet doesn't break the streak
  while (activeDates.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  return { current, longest, longestEnd };
}

export function computeStats(userId: string, range: string, tz: string) {
  const days = RANGES[range] ?? null;
  const since = days ? new Date(Date.now() - days * 86400_000).toISOString() : '0000';
  const today = parts(Date.now(), tz).date;

  const sessions = q.all(`SELECT s.*, t.title, t.cover_url, t.source FROM reading_sessions s LEFT JOIN titles t ON t.id = s.title_id
                           WHERE s.user_id = ? AND s.started_at >= ? AND s.active_seconds > 0 ORDER BY s.started_at`, userId, since);
  const reads = q.all(`SELECT r.*, t.title, t.type FROM chapter_reads r LEFT JOIN titles t ON t.id = r.title_id WHERE r.user_id = ? AND r.read_at >= ? ORDER BY r.read_at`, userId, since);
  const lib = q.all(`SELECT l.*, t.type, t.title, t.genres, t.cover_url, t.source, t.source_id FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ?`, userId);

  const daily = new Map<string, { seconds: number; chapters: number }>();
  const monthly = new Map<string, { seconds: number; chapters: number; titles: Set<string> }>();
  const yearly = new Map<number, { seconds: number; chapters: number }>();
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, chapters: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, day) => ({ day, seconds: 0, chapters: 0 }));
  const dayParts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const genreSeconds = new Map<string, number>();
  const genreChapters = new Map<string, number>();
  const genreMonthly = new Map<string, Map<string, number>>();
  const typeSeconds = new Map<string, number>();
  const titleAgg = new Map<string, { titleId: string; title: string; coverUrl: string | null; source: string; seconds: number; chapters: number; sessions: number }>();
  const day = (k: string) => daily.get(k) ?? (daily.set(k, { seconds: 0, chapters: 0 }), daily.get(k)!);
  const mon = (k: string) => monthly.get(k) ?? (monthly.set(k, { seconds: 0, chapters: 0, titles: new Set() }), monthly.get(k)!);
  const yr = (k: number) => yearly.get(k) ?? (yearly.set(k, { seconds: 0, chapters: 0 }), yearly.get(k)!);
  const ttl = (r: any) => titleAgg.get(r.title_id) ?? (titleAgg.set(r.title_id, { titleId: r.title_id, title: r.title ?? 'Unknown', coverUrl: proxied(r.cover_url ?? null, r.source), source: r.source, seconds: 0, chapters: 0, sessions: 0 }), titleAgg.get(r.title_id)!);

  let totalSeconds = 0, longest: any = null;
  for (const s of sessions) {
    totalSeconds += s.active_seconds;
    if (!longest || s.active_seconds > longest.active_seconds) longest = s;
    // Spread the session's active time across the hours its wall-clock window covered.
    const start = Date.parse(s.started_at);
    const end = Math.max(start + s.active_seconds * 1000, Date.parse(s.ended_at ?? s.last_beat_at));
    const span = Math.max(1, end - start);
    for (let t = start; t < end; ) {
      const next = Math.min(end, (Math.floor(t / 3600_000) + 1) * 3600_000);
      const sec = (s.active_seconds * (next - t)) / span;
      const p = parts(t, tz);
      byHour[p.hour].seconds += sec;
      byWeekday[p.weekday].seconds += sec;
      dayParts[DAYPART(p.hour)] += sec;
      day(p.date).seconds += sec;
      mon(p.month).seconds += sec;
      yr(p.year).seconds += sec;
      t = next;
    }
    const genres: string[] = json(s.genres, []);
    for (const g of genres) genreSeconds.set(g, (genreSeconds.get(g) ?? 0) + s.active_seconds / Math.max(1, genres.length));
    typeSeconds.set(s.content_type ?? 'manga', (typeSeconds.get(s.content_type ?? 'manga') ?? 0) + s.active_seconds);
    const ta = ttl(s);
    ta.seconds += s.active_seconds;
    ta.sessions += 1;
  }
  for (const r of reads) {
    const p = parts(r.read_at, tz);
    day(p.date).chapters++;
    const m = mon(p.month);
    m.chapters++;
    m.titles.add(r.title_id);
    yr(p.year).chapters++;
    byHour[p.hour].chapters++;
    byWeekday[p.weekday].chapters++;
    for (const g of json<string[]>(r.genres, [])) {
      genreChapters.set(g, (genreChapters.get(g) ?? 0) + 1);
      const gm = genreMonthly.get(p.month) ?? new Map();
      gm.set(g, (gm.get(g) ?? 0) + 1);
      genreMonthly.set(p.month, gm);
    }
    ttl(r).chapters++;
  }

  const activeDates = new Set([...daily.entries()].filter(([, v]) => v.chapters > 0 || v.seconds >= 60).map(([k]) => k));
  // Streaks always look at all-time history so a short range doesn't truncate them.
  const allDates = new Set<string>();
  for (const r of q.all<{ read_at: string }>('SELECT read_at FROM chapter_reads WHERE user_id = ?', userId)) allDates.add(parts(r.read_at, tz).date);
  for (const s of q.all<{ started_at: string; active_seconds: number }>('SELECT started_at, active_seconds FROM reading_sessions WHERE user_id = ? AND active_seconds >= 60', userId)) allDates.add(parts(s.started_at, tz).date);
  const streak = streaks(allDates, today);

  const firstActivity = [...allDates].sort()[0] ?? today;
  const spanDays = days ?? Math.max(1, Math.round((Date.parse(today) - Date.parse(firstActivity)) / 86400_000) + 1);
  const sessionsWithChapters = sessions.filter((s) => s.chapters_completed > 0);
  const mostActiveDay = [...daily.entries()].sort((a, b) => b[1].seconds - a[1].seconds)[0];

  const completed = lib.filter((l) => l.status === 'completed');
  const dropped = lib.filter((l) => l.status === 'dropped');
  const inRange = (iso: string | null) => !!iso && iso >= since;
  const genreTotal = [...genreSeconds.values()].reduce((a, b) => a + b, 0) || 1;
  const genreList = [...new Set([...genreSeconds.keys(), ...genreChapters.keys()])]
    .map((g) => ({ genre: g, seconds: Math.round(genreSeconds.get(g) ?? 0), chapters: genreChapters.get(g) ?? 0, share: (genreSeconds.get(g) ?? 0) / genreTotal }))
    .sort((a, b) => b.seconds - a.seconds || b.chapters - a.chapters);
  const topGenres = genreList.slice(0, 6).map((g) => g.genre);
  const months = [...monthly.keys()].sort();

  // Fill daily series for the selected range (or last year for "all") so heatmaps have no gaps.
  const fillDays = Math.min(days ?? 365, 366);
  const series = Array.from({ length: fillDays }, (_, i) => {
    const d = addDays(today, i - fillDays + 1);
    const v = daily.get(d);
    return { date: d, seconds: Math.round(v?.seconds ?? 0), chapters: v?.chapters ?? 0 };
  });

  const revisited = q.all(`SELECT p.title_id, t.title, t.cover_url, t.source, SUM(p.read_count) reads, COUNT(*) chapters FROM reading_progress p JOIN titles t ON t.id = p.title_id
                            WHERE p.user_id = ? AND p.read_count > 1 GROUP BY p.title_id ORDER BY SUM(p.read_count) - COUNT(*) DESC LIMIT 5`, userId);

  return {
    range, tz,
    totals: {
      titlesRead: new Set(reads.map((r) => r.title_id)).size,
      chaptersRead: reads.length,
      mangaCompleted: completed.filter((l) => l.type !== 'novel' && (days === null || inRange(l.completed_at))).length,
      novelsCompleted: completed.filter((l) => l.type === 'novel' && (days === null || inRange(l.completed_at))).length,
      novelChaptersRead: reads.filter((r) => r.type === 'novel').length,
      volumesCompleted: lib.reduce((n, l) => n + (l.progress_volume ?? 0), 0),
      sessions: sessions.length,
      totalSeconds: Math.round(totalSeconds),
      avgSessionSeconds: sessions.length ? Math.round(totalSeconds / sessions.length) : 0,
      avgDailySeconds: Math.round(totalSeconds / spanDays),
      longestSession: longest ? { seconds: longest.active_seconds, title: longest.title, titleId: longest.title_id, at: longest.started_at } : null,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      activeDays: activeDates.size,
      mostActiveDay: mostActiveDay ? { date: mostActiveDay[0], seconds: Math.round(mostActiveDay[1].seconds), chapters: mostActiveDay[1].chapters } : null,
    },
    habits: {
      avgChaptersPerSession: sessionsWithChapters.length ? +(sessionsWithChapters.reduce((n, s) => n + s.chapters_completed, 0) / sessionsWithChapters.length).toFixed(1) : 0,
      avgChaptersPerDay: +(reads.length / spanDays).toFixed(2),
      avgChaptersPerActiveDay: activeDates.size ? +(reads.length / activeDates.size).toFixed(1) : 0,
      readingFrequency: +(activeDates.size / spanDays).toFixed(3),
      completionRate: completed.length + dropped.length ? +(completed.length / (completed.length + dropped.length)).toFixed(3) : null,
      mostRevisited: revisited.map((r) => ({ titleId: r.title_id, title: r.title, coverUrl: proxied(r.cover_url, r.source), source: r.source, rereads: r.reads - r.chapters })),
      mostAbandoned: dropped.sort((a, b) => b.progress_chapter - a.progress_chapter).slice(0, 5)
        .map((l) => ({ titleId: l.title_id, title: l.title, coverUrl: proxied(l.cover_url, l.source), source: l.source, progressChapter: l.progress_chapter, droppedAt: l.updated_at })),
    },
    daily: series,
    monthly: months.map((m) => ({ month: m, seconds: Math.round(monthly.get(m)!.seconds), chapters: monthly.get(m)!.chapters, titles: monthly.get(m)!.titles.size })),
    yearly: [...yearly.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, seconds: Math.round(v.seconds), chapters: v.chapters })),
    byHour: byHour.map((h) => ({ ...h, seconds: Math.round(h.seconds) })),
    byWeekday: byWeekday.map((d) => ({ ...d, seconds: Math.round(d.seconds) })),
    dayParts: Object.fromEntries(Object.entries(dayParts).map(([k, v]) => [k, Math.round(v)])),
    genres: genreList,
    genreTrend: months.map((m) => ({ month: m, ...Object.fromEntries(topGenres.map((g) => [g, genreMonthly.get(m)?.get(g) ?? 0])) })),
    topGenres,
    types: [...typeSeconds.entries()].map(([type, seconds]) => ({ type, seconds: Math.round(seconds) })).sort((a, b) => b.seconds - a.seconds),
    topTitles: [...titleAgg.values()].sort((a, b) => b.seconds - a.seconds || b.chapters - a.chapters).slice(0, 10).map((t) => ({ ...t, seconds: Math.round(t.seconds) })),
    library: Object.fromEntries(['reading', 'completed', 'planning', 'on_hold', 'dropped', 'rereading'].map((s) => [s, lib.filter((l) => l.status === s).length])),
    timeline: sessions.slice(-30).reverse().map((s) => ({ id: s.id, titleId: s.title_id, title: s.title, startedAt: s.started_at, seconds: s.active_seconds, chapters: s.chapters_completed, pages: s.pages_read })),
  };
}

export function computeWrapped(userId: string, year: number, tz: string) {
  const from = `${year}-01-01T00:00:00.000Z`;
  const to = `${year + 1}-01-01T00:00:00.000Z`;
  const sessions = q.all('SELECT * FROM reading_sessions WHERE user_id = ? AND started_at >= ? AND started_at < ? AND active_seconds > 0', userId, from, to);
  const reads = q.all(`SELECT r.*, t.title, t.cover_url, t.source, t.type FROM chapter_reads r LEFT JOIN titles t ON t.id = r.title_id WHERE r.user_id = ? AND r.read_at >= ? AND r.read_at < ? ORDER BY r.read_at`, userId, from, to);
  const completed = q.all(`SELECT l.*, t.title, t.cover_url, t.source, t.type FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ? AND l.status = 'completed' AND l.completed_at >= ? AND l.completed_at < ?`, userId, from, to);
  const seconds = sessions.reduce((n, s) => n + s.active_seconds, 0);
  const genres = new Map<string, number>();
  const titles = new Map<string, { titleId: string; title: string; coverUrl: string; source: string; chapters: number }>();
  const months = new Map<string, number>();
  const hours = Array(24).fill(0);
  for (const r of reads) {
    for (const g of json<string[]>(r.genres, [])) genres.set(g, (genres.get(g) ?? 0) + 1);
    const t = titles.get(r.title_id) ?? { titleId: r.title_id, title: r.title, coverUrl: proxied(r.cover_url, r.source)!, source: r.source, chapters: 0 };
    t.chapters++;
    titles.set(r.title_id, t);
    const p = parts(r.read_at, tz);
    months.set(p.month, (months.get(p.month) ?? 0) + 1);
    hours[p.hour]++;
  }
  const prevGenres = new Set(q.all(`SELECT genres FROM chapter_reads WHERE user_id = ? AND read_at < ?`, userId, from).flatMap((r) => json<string[]>(r.genres, [])));
  const topHour = hours.indexOf(Math.max(...hours));
  const persona = !reads.length ? 'Just getting started'
    : DAYPART(topHour) === 'night' ? 'Night Owl' : DAYPART(topHour) === 'morning' ? 'Early Bird'
    : titles.size > 40 ? 'Explorer' : completed.length > 15 ? 'Finisher' : 'Devoted Reader';
  const dates = new Set(reads.map((r) => parts(r.read_at, tz).date));
  return {
    year,
    totals: { seconds, chapters: reads.length, titles: titles.size, completed: completed.length, sessions: sessions.length, activeDays: dates.size },
    topGenres: [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([genre, chapters]) => ({ genre, chapters })),
    newGenres: [...genres.keys()].filter((g) => !prevGenres.has(g)).slice(0, 8),
    topTitles: [...titles.values()].sort((a, b) => b.chapters - a.chapters).slice(0, 5),
    topMonth: [...months.entries()].sort((a, b) => b[1] - a[1])[0] ?? null,
    months: Array.from({ length: 12 }, (_, i) => { const k = `${year}-${String(i + 1).padStart(2, '0')}`; return { month: k, chapters: months.get(k) ?? 0 }; }),
    topHour: reads.length ? topHour : null,
    longestStreak: streaks(dates, `${year}-12-31`).longest,
    firstRead: reads[0] ? { title: reads[0].title, titleId: reads[0].title_id, at: reads[0].read_at } : null,
    completedTitles: completed.slice(0, 24).map((c) => ({ titleId: c.title_id, title: c.title, coverUrl: proxied(c.cover_url, c.source), source: c.source })),
    persona,
  };
}
