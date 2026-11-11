import { Router } from 'express';
import { z } from 'zod';
import { q, json } from '../db/index.js';
import { h, query, notFound, forbidden } from '../lib/http.js';
import { me } from '../lib/auth.js';
import { computeStats, computeWrapped, RANGES } from '../services/stats.js';
import { canSee, hiddenUserIds, miniUser, userSelect, areFriends } from '../services/users.js';
import { getPrefs } from '../services/prefs.js';
import { toTitle } from '../sources/registry.js';

export const stats = Router();

function targetUser(req: any) {
  const username = req.query.user as string | undefined;
  if (!username) return me(req).id;
  const row = q.get(`${userSelect} WHERE u.username = ?`, username);
  if (!row) throw notFound('User not found');
  if (!canSee(row, 'stats', req.user?.id)) throw forbidden('These statistics are private.');
  return row.id as string;
}

stats.get('/', h((req) => {
  const f = query(z.object({ range: z.enum(Object.keys(RANGES) as [string, ...string[]]).default('30d'), tz: z.string().max(60).default('UTC') }), req);
  return computeStats(targetUser(req), f.range, f.tz);
}));

stats.get('/wrapped', h((req) => {
  const f = query(z.object({ year: z.coerce.number().int().min(2000).max(3000).default(new Date().getFullYear()), tz: z.string().max(60).default('UTC') }), req);
  const uid = targetUser(req);
  const years = q.all<{ y: string }>(`SELECT DISTINCT substr(read_at, 1, 4) y FROM chapter_reads WHERE user_id = ? ORDER BY y DESC`, uid).map((r) => Number(r.y));
  return { ...computeWrapped(uid, f.year, f.tz), availableYears: years };
}));

// ---------------- Rankings ----------------
const PERIOD: Record<string, string | null> = { day: '-1 day', week: '-7 days', month: '-30 days', year: '-365 days', all: null };
const CAP_PER_DAY = 300; // validation: ignore implausible chapter counts beyond this per user per day

export const rankings = Router();

rankings.get('/:category', h((req) => {
  const f = query(z.object({
    period: z.enum(['day', 'week', 'month', 'year', 'all']).default('week'),
    scope: z.enum(['global', 'friends', 'region']).default('global'),
    genre: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }), req);
  const since = PERIOD[f.period] ? `strftime('%Y-%m-%dT%H:%M:%fZ','now','${PERIOD[f.period]}')` : `'0000'`;
  const viewer = req.user?.id;
  const hidden = new Set(hiddenUserIds(viewer));
  const genreFilter = f.genre ? `AND EXISTS (SELECT 1 FROM json_each(r.genres) WHERE value = ?)` : '';
  const gp = f.genre ? [f.genre] : [];
  let rows: { user_id?: string; title_id?: string; list_id?: string; value: number }[] = [];
  const cat = req.params.category;

  switch (cat) {
    case 'chapters':
      rows = q.all(`SELECT user_id, SUM(MIN(n, ${CAP_PER_DAY})) value FROM (
                      SELECT user_id, substr(read_at, 1, 10) d, COUNT(*) n FROM chapter_reads r WHERE read_at >= ${since} ${genreFilter} GROUP BY user_id, d)
                    GROUP BY user_id ORDER BY value DESC LIMIT 500`, ...gp);
      break;
    case 'completed':
    case 'novels':
      rows = q.all(`SELECT l.user_id, COUNT(*) value FROM library_entries l JOIN titles t ON t.id = l.title_id
                     WHERE l.status = 'completed' AND l.completed_at >= ${since} AND t.type ${cat === 'novels' ? "= 'novel'" : "!= 'novel'"}
                     ${f.genre ? 'AND EXISTS (SELECT 1 FROM json_each(t.genres) WHERE value = ?)' : ''} GROUP BY l.user_id ORDER BY value DESC LIMIT 500`, ...gp);
      break;
    case 'time':
      rows = q.all(`SELECT user_id, SUM(active_seconds) value FROM reading_sessions r WHERE flagged = 0 AND started_at >= ${since} ${genreFilter}
                     GROUP BY user_id ORDER BY value DESC LIMIT 500`, ...gp);
      break;
    case 'active':
      rows = q.all(`SELECT user_id, COUNT(DISTINCT substr(read_at, 1, 10)) value FROM chapter_reads r WHERE read_at >= ${since} ${genreFilter}
                     GROUP BY user_id ORDER BY value DESC LIMIT 500`, ...gp);
      break;
    case 'community':
      rows = q.all(`SELECT user_id, SUM(w) value FROM (
                      SELECT user_id, 1 + MAX(score, 0) * 0.5 w FROM comments WHERE deleted = 0 AND hidden = 0 AND created_at >= ${since}
                      UNION ALL SELECT user_id, 3 FROM threads WHERE deleted = 0 AND created_at >= ${since}
                      UNION ALL SELECT user_id, 5 FROM reviews WHERE deleted = 0 AND created_at >= ${since})
                    GROUP BY user_id ORDER BY value DESC LIMIT 500`);
      break;
    case 'top_rated': {
      const titles = q.all(`SELECT t.*, AVG(l.rating) avg, COUNT(l.rating) n,
                              (AVG(l.rating) * COUNT(l.rating) + 7.0 * 5) / (COUNT(l.rating) + 5) value
                              FROM library_entries l JOIN titles t ON t.id = l.title_id
                             WHERE l.rating IS NOT NULL AND l.updated_at >= ${since}
                             ${f.genre ? 'AND EXISTS (SELECT 1 FROM json_each(t.genres) WHERE value = ?)' : ''}
                             GROUP BY t.id ORDER BY value DESC LIMIT ?`, ...gp, f.limit);
      return { kind: 'titles', items: titles.map((t, i) => ({ rank: i + 1, value: +t.value.toFixed(2), extra: { avg: +t.avg.toFixed(2), ratings: t.n }, title: toTitle(t) })) };
    }
    case 'popular_titles': {
      const titles = q.all(`SELECT t.*, COUNT(DISTINCT r.user_id) value FROM chapter_reads r JOIN titles t ON t.id = r.title_id
                             WHERE r.read_at >= ${since} ${genreFilter} GROUP BY t.id ORDER BY value DESC LIMIT ?`, ...gp, f.limit);
      return { kind: 'titles', items: titles.map((t, i) => ({ rank: i + 1, value: t.value, extra: { readers: t.value }, title: toTitle(t) })) };
    }
    case 'lists': {
      const lists = q.all(`SELECT l.*, COUNT(k.user_id) value, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) items, u.username, u.display_name, p.avatar_url, u.role, u.id uid
                             FROM lists l JOIN users u ON u.id = l.owner_id LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN list_likes k ON k.list_id = l.id
                            WHERE l.visibility = 'public' AND l.created_at >= ${since} GROUP BY l.id ORDER BY value DESC, items DESC LIMIT ?`, f.limit);
      return { kind: 'lists', items: lists.filter((l) => !hidden.has(l.uid)).map((l, i) => ({ rank: i + 1, value: l.value, list: { id: l.id, name: l.name, slug: l.share_slug, items: l.items, coverUrl: l.cover_url }, user: miniUser({ ...l, id: l.uid }) })) };
    }
    default:
      throw notFound('Unknown ranking');
  }

  // User rankings: apply privacy, blocks and scope filters.
  let eligible = rows.filter((r) => r.user_id && !hidden.has(r.user_id) && getPrefs(r.user_id).privacy.showInRankings !== false);
  const users = new Map(eligible.length ? q.all(`${userSelect} WHERE u.id IN (${eligible.map(() => '?').join(',')})`, ...eligible.map((r) => r.user_id!)).map((u) => [u.id, u]) : []);
  eligible = eligible.filter((r) => {
    const u = users.get(r.user_id!);
    if (!u || (!u.is_public && !(viewer && (viewer === u.id || areFriends(viewer, u.id))))) return false;
    if (f.scope === 'friends') return !!viewer && (r.user_id === viewer || areFriends(viewer, r.user_id!));
    if (f.scope === 'region') {
      const mine = viewer ? q.get<{ region: string | null }>('SELECT region FROM profiles WHERE user_id = ?', viewer)?.region : null;
      return !!mine && u.region === mine;
    }
    return true;
  });
  const items = eligible.slice(0, f.limit).map((r, i) => ({ rank: i + 1, value: Math.round(r.value), user: miniUser(users.get(r.user_id!)) }));
  const myIndex = viewer ? eligible.findIndex((r) => r.user_id === viewer) : -1;
  return { kind: 'users', items, me: myIndex >= 0 ? { rank: myIndex + 1, value: Math.round(eligible[myIndex].value) } : null, regionSet: viewer ? !!q.get('SELECT region FROM profiles WHERE user_id = ? AND region IS NOT NULL', viewer) : false };
}));

