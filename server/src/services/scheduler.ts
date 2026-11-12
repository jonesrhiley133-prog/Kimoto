import { q, now } from '../db/index.js';
import { loadChapters, provider, splitId } from '../sources/registry.js';
import { notify, sendDigests } from './notify.js';
import { getPrefs } from './prefs.js';

/**
 * Background jobs:
 *  - new chapter detection for titles someone follows (library entries with notify on)
 *  - hourly/daily push digests
 *  - housekeeping (expired sessions/tokens, dangling reading sessions)
 */
const CHECK_BATCH = 15;

export async function checkNewChapters() {
  const titles = q.all<{ title_id: string; checked_at: string | null; last_chapter_id: string | null }>(
    `SELECT DISTINCT l.title_id, w.checked_at, w.last_chapter_id FROM library_entries l LEFT JOIN chapter_watch w ON w.title_id = l.title_id
      WHERE l.notify = 1 AND l.status IN ('reading', 'rereading', 'planning', 'on_hold')
      ORDER BY w.checked_at IS NOT NULL, w.checked_at LIMIT ?`, CHECK_BATCH);
  for (const t of titles) {
    try {
      const { source } = splitId(t.title_id);
      if (!provider(source).capabilities.chapters || source === 'local') {
        q.run('INSERT INTO chapter_watch (title_id, checked_at) VALUES (?, ?) ON CONFLICT(title_id) DO UPDATE SET checked_at = excluded.checked_at', t.title_id, now());
        continue;
      }
      const followers = q.all<{ user_id: string }>('SELECT user_id FROM library_entries WHERE title_id = ? AND notify = 1', t.title_id);
      const langs = [...new Set(followers.flatMap((f) => getPrefs(f.user_id).chapterLanguages ?? ['en']))];
      const { chapters, stale } = await loadChapters(t.title_id, langs, true);
      if (stale || !chapters.length) continue;
      const newest = [...chapters].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0];
      if (t.checked_at && t.last_chapter_id !== newest.id) {
        const fresh = chapters.filter((c) => (c.publishedAt ?? '') > t.checked_at!);
        const meta = q.get<{ title: string; cover_url: string | null }>('SELECT title, cover_url FROM titles WHERE id = ?', t.title_id);
        for (const f of followers) {
          const mine = fresh.filter((c) => (getPrefs(f.user_id).chapterLanguages ?? ['en']).includes(c.language ?? 'en'));
          if (!mine.length) continue;
          const label = mine.length === 1 ? `Chapter ${mine[0].numberLabel ?? '?'}${mine[0].name ? ` — ${mine[0].name}` : ''}` : `${mine.length} new chapters`;
          notify({ userId: f.user_id, kind: 'chapter', title: `New: ${meta?.title}`, body: label, link: `/title/${encodeURIComponent(t.title_id)}`, data: { titleId: t.title_id, chapterIds: mine.map((c) => c.id) } });
        }
      }
      q.run('INSERT INTO chapter_watch (title_id, last_chapter_id, checked_at) VALUES (?,?,?) ON CONFLICT(title_id) DO UPDATE SET last_chapter_id = excluded.last_chapter_id, checked_at = excluded.checked_at',
        t.title_id, newest.id, now());
    } catch (e: any) {
      q.run('INSERT INTO chapter_watch (title_id, checked_at) VALUES (?, ?) ON CONFLICT(title_id) DO UPDATE SET checked_at = excluded.checked_at', t.title_id, now());
      console.warn(`[scheduler] chapter check failed for ${t.title_id}: ${e.message}`);
    }
  }
}

function housekeeping() {
  q.run(`DELETE FROM sessions WHERE expires_at < ?`, now());
  q.run(`DELETE FROM email_tokens WHERE expires_at < ?`, now());
  q.run(`UPDATE reading_sessions SET ended_at = last_beat_at WHERE ended_at IS NULL AND last_beat_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')`);
  q.run(`DELETE FROM reading_sessions WHERE ended_at IS NOT NULL AND active_seconds < 5 AND chapters_completed = 0`);
}

export function startScheduler() {
  const every = (ms: number, fn: () => unknown) => setInterval(() => Promise.resolve().then(fn).catch((e) => console.error('[scheduler]', e)), ms).unref();
  every(20 * 60_000, checkNewChapters);
  every(60 * 60_000, () => sendDigests('hourly'));
  every(24 * 60 * 60_000, () => sendDigests('daily'));
  every(10 * 60_000, housekeeping);
  setTimeout(() => { housekeeping(); checkNewChapters().catch(() => undefined); }, 15_000).unref();
}
