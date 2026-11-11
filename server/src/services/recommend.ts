import { q, json } from '../db/index.js';
import { TTLCache } from '../lib/util.js';
import { metaToDTO, toTitle, userProviders, type TitleDTO } from '../sources/registry.js';
import { getPrefs } from './prefs.js';

/**
 * Content-based recommender:
 *  1. Build a taste profile — weights per genre, tag and author — from the user's library (status,
 *     rating, favorites), validated chapter reads, and onboarding genre picks.
 *  2. Gather candidates: cached titles plus fresh results from enabled providers for the top genres.
 *  3. Score candidates by affinity + quality + popularity, skip what's already in the library,
 *     and attach a human-readable reason.
 */
const pool = new TTLCache<TitleDTO[]>(30 * 60_000);
const STATUS_W: Record<string, number> = { completed: 1.2, reading: 1, rereading: 1.4, on_hold: 0.4, planning: 0.3, dropped: -0.8 };

export async function recommendFor(userId: string, limit = 24) {
  const prefs = getPrefs(userId);
  const genreW = new Map<string, number>();
  const tagW = new Map<string, number>();
  const authorW = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const anchors = new Map<string, string>(); // genre -> a loved title that carries it (for "because you liked")

  const lib = q.all('SELECT l.*, t.genres, t.tags, t.authors, t.title FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ?', userId);
  for (const l of lib) {
    let w = STATUS_W[l.status] ?? 0.3;
    if (l.rating) w *= (l.rating - 5) / 2.5; // 10 → ×2, 5 → 0, 1 → negative
    if (l.favorite) w += 1.5;
    for (const g of json<string[]>(l.genres, [])) {
      bump(genreW, g, w);
      if (w > 1.5 && !anchors.has(g)) anchors.set(g, l.title);
    }
    for (const t of json<string[]>(l.tags, [])) bump(tagW, t, w * 0.5);
    for (const a of json<string[]>(l.authors, [])) bump(authorW, a, w * 1.5);
  }
  for (const r of q.all(`SELECT genres, COUNT(*) n FROM chapter_reads WHERE user_id = ? AND read_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days') GROUP BY title_id`, userId)) {
    for (const g of json<string[]>(r.genres, [])) bump(genreW, g, Math.log2(1 + r.n) * 0.4);
  }
  for (const g of prefs.favoriteGenres ?? []) bump(genreW, g, 2);

  const topGenres = [...genreW.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
  const owned = new Set(lib.map((l) => l.title_id));
  const ownedNames = new Set(lib.map((l) => String(l.title).toLowerCase()));
  const types = new Set(prefs.contentTypes ?? []);

  // Candidates from providers (cached per genre set).
  const providers = userProviders(userId).filter((p) => p.capabilities.search);
  const key = `${providers.map((p) => p.id).join(',')}|${topGenres.join(',')}`;
  const fetched = await pool.wrap(key, async () => {
    const tasks = providers.flatMap((p) => (topGenres.length ? topGenres : [undefined]).map(async (g) => {
      const r = await p.search({ genres: g ? [g] : undefined, sort: 'popular', limit: 30, offset: 0, contentRating: prefs.contentRating });
      return r.items.map((m) => metaToDTO(p.id, m));
    }));
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  }).catch(() => [] as TitleDTO[]);
  const cached = q.all('SELECT * FROM titles ORDER BY cached_at DESC LIMIT 400').map(toTitle);

  const seen = new Set<string>();
  const maxFollows = Math.max(1, ...[...fetched, ...cached].map((t) => t.sourceFollows ?? 0));
  const scored = [...fetched, ...cached].flatMap((t) => {
    const nameKey = t.title.toLowerCase();
    if (owned.has(t.id) || ownedNames.has(nameKey) || seen.has(nameKey)) return [];
    if (types.size && !types.has(t.type as any)) return [];
    if (t.contentRating && !prefs.contentRating.includes(t.contentRating)) return [];
    seen.add(nameKey);
    let affinity = 0;
    let best: { g: string; v: number } | null = null;
    for (const g of t.genres) {
      const v = genreW.get(g) ?? 0;
      affinity += v;
      if (!best || v > best.v) best = { g, v };
    }
    affinity /= Math.sqrt(Math.max(1, t.genres.length));
    for (const tag of t.tags) affinity += (tagW.get(tag) ?? 0) * 0.3;
    const author = t.authors.find((a) => (authorW.get(a) ?? 0) > 0);
    if (author) affinity += authorW.get(author)! * 1.5;
    const quality = t.sourceRating ? (t.sourceRating - 6) * 0.6 : 0;
    const popularity = Math.log10(1 + (t.sourceFollows ?? 0)) / Math.log10(1 + maxFollows);
    const score = affinity + quality + popularity * 1.2 + Math.random() * 0.3; // small jitter keeps the shelf fresh
    const reason = author ? `By ${author}, whom you've enjoyed`
      : best && best.v > 0 ? (anchors.get(best.g) ? `Because you liked ${anchors.get(best.g)}` : `Popular in ${best.g}`)
      : 'Popular right now';
    return [{ title: t, score, reason }];
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  return { items: top.map((s) => s.title), reasons: Object.fromEntries(top.map((s) => [s.title.id, s.reason])), basedOn: topGenres };
}
