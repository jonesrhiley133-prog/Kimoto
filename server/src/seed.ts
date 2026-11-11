/**
 * Optional demo seed: `npm run seed` creates three demo accounts (password: kimoto-demo) with
 * friendships, library entries, a public list, comments and a DM so every screen has something to
 * show. Pass `--history` to also generate ~4 months of SIMULATED reading sessions for the demo
 * accounts only (clearly fake data, for previewing the statistics screens). Never run on a real
 * instance with real users.
 */
import { q, tx, now } from './db/index.js';
import { hashPassword } from './lib/auth.js';
import { id } from './lib/util.js';
import { ensureSampleLibrary } from './sample.js';
import { loadChapters, loadTitle, provider, metaToDTO } from './sources/registry.js';

const withHistory = process.argv.includes('--history');

async function main() {
  ensureSampleLibrary();
  const local = provider('local');
  const all = await local.search({ limit: 50, offset: 0 });
  const titleIds = all.items.map((m) => metaToDTO('local', m).id);
  for (const t of titleIds) { await loadTitle(t); await loadChapters(t, ['en']); }

  const hash = await hashPassword('kimoto-demo');
  const demo = [
    { username: 'alice', name: 'Alice', role: 'admin', bio: 'Collector of seinen and cozy fantasy. Admin of this instance.' },
    { username: 'bob', name: 'Bob', role: 'moderator', bio: 'Webtoons on the commute, light novels at night.' },
    { username: 'chiyo', name: 'Chiyo', role: 'user', bio: 'Here for the folklore stories.' },
  ];
  const ids: Record<string, string> = {};
  tx(() => {
    for (const d of demo) {
      const existing = q.get<{ id: string }>('SELECT id FROM users WHERE username = ?', d.username);
      if (existing) { ids[d.username] = existing.id; continue; }
      const uid = id();
      ids[d.username] = uid;
      q.run('INSERT INTO users (id, email, username, display_name, password_hash, role, email_verified) VALUES (?,?,?,?,?,?,1)', uid, `${d.username}@demo.kimoto.local`, d.username, d.name, hash, d.role);
      q.run('INSERT INTO profiles (user_id, bio, favorite_genres) VALUES (?, ?, ?)', uid, d.bio, JSON.stringify(['Fantasy', 'Adventure']));
      q.run('INSERT INTO preferences (user_id, data) VALUES (?, ?)', uid, JSON.stringify({ onboarded: true }));
    }
    const pair = (a: string, b: string) => q.run(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted') ON CONFLICT DO NOTHING`, ids[a], ids[b]);
    pair('alice', 'bob');
    pair('bob', 'chiyo');
    q.run('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING', ids.chiyo, ids.alice);

    const [manga, webtoon, novel] = ['local:lanterns-over-kirihara', 'local:skyline-courier', 'local:the-cartographers-apprentice'];
    const entry = (u: string, t: string, status: string, progress: number, rating: number | null, fav = 0) =>
      q.run(`INSERT INTO library_entries (user_id, title_id, status, progress_chapter, rating, favorite, started_at, completed_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        ids[u], t, status, progress, rating, fav, now(), status === 'completed' ? now() : null);
    entry('alice', manga, 'reading', 2, 9, 1);
    entry('alice', novel, 'completed', 3, 8);
    entry('bob', webtoon, 'reading', 1, 7);
    entry('bob', manga, 'planning', 0, null);
    entry('chiyo', manga, 'completed', 3, 10, 1);

    if (!q.get('SELECT 1 FROM lists WHERE owner_id = ?', ids.alice)) {
      const lid = id();
      q.run(`INSERT INTO lists (id, owner_id, name, description, visibility, share_slug) VALUES (?,?,?,?, 'public', ?)`, lid, ids.alice, 'Cozy Folklore Reads', 'Lantern light, old shrines and gentle magic.', id(10));
      [manga, novel].forEach((t, i) => q.run('INSERT INTO list_items (list_id, title_id, position, added_by) VALUES (?,?,?,?)', lid, t, i + 1, ids.alice));
    }
    const ch1 = q.get<{ id: string }>('SELECT id FROM chapters WHERE title_id = ? ORDER BY sort_key LIMIT 1', manga);
    if (ch1 && !q.get('SELECT 1 FROM comments WHERE target_id = ?', ch1.id)) {
      const c1 = id();
      q.run(`INSERT INTO comments (id, target_type, target_id, title_id, user_id, body) VALUES (?, 'chapter', ?, ?, ?, ?)`, c1, ch1.id, manga, ids.chiyo, 'The lantern moving against the wind gave me chills. Great opener!');
      q.run(`INSERT INTO comments (id, target_type, target_id, title_id, user_id, parent_id, depth, body, spoiler) VALUES (?, 'chapter', ?, ?, ?, ?, 1, ?, 1)`, id(), ch1.id, manga, ids.alice, c1, 'Wait until you see who is behind the gate in chapter 2…');
      q.run(`INSERT INTO threads (id, title_id, user_id, category, subject, body) VALUES (?, ?, ?, 'theories', ?, ?)`, id(), manga, ids.bob, 'Who built the shrine gate?', 'The town records skip exactly forty years. Coincidence? Post your theories.');
    }
    const key = [ids.alice, ids.bob].sort().join(':');
    if (!q.get('SELECT 1 FROM conversations WHERE dm_key = ?', key)) {
      const cid = id();
      q.run(`INSERT INTO conversations (id, kind, created_by, dm_key) VALUES (?, 'dm', ?, ?)`, cid, ids.alice, key);
      for (const u of [ids.alice, ids.bob]) q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, u);
      q.run('INSERT INTO messages (id, conversation_id, user_id, body) VALUES (?,?,?,?)', id(), cid, ids.bob, 'Have you started Skyline Courier yet? Episode 2 is wild.');
    }
  });

  if (withHistory) {
    console.log('[seed] Generating SIMULATED reading history for demo accounts (not real activity).');
    const chapters = q.all<{ id: string; title_id: string }>('SELECT id, title_id FROM chapters');
    const titleMeta = new Map(q.all('SELECT id, type, genres FROM titles').map((t) => [t.id, t]));
    tx(() => {
      for (const u of Object.values(ids)) {
        q.run('DELETE FROM reading_sessions WHERE user_id = ?', u);
        q.run('DELETE FROM chapter_reads WHERE user_id = ?', u);
        for (let d = 120; d >= 0; d--) {
          if (Math.random() < 0.35) continue;
          const sessions = 1 + Math.floor(Math.random() * 2);
          for (let s = 0; s < sessions; s++) {
            const hour = [7, 12, 19, 21, 23, 1][Math.floor(Math.random() * 6)];
            const start = new Date(Date.now() - d * 86400_000);
            start.setUTCHours(hour, Math.floor(Math.random() * 60), 0, 0);
            const secs = 300 + Math.floor(Math.random() * 3000);
            const ch = chapters[Math.floor(Math.random() * chapters.length)];
            const meta = titleMeta.get(ch.title_id);
            const sid = id();
            const n = 1 + Math.floor(Math.random() * 4);
            q.run(`INSERT INTO reading_sessions (id, user_id, title_id, chapter_id, started_at, last_beat_at, ended_at, active_seconds, pages_read, chapters_completed, content_type, genres, device)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'demo')`, sid, u, ch.title_id, ch.id, start.toISOString(), new Date(start.getTime() + secs * 1000).toISOString(),
            new Date(start.getTime() + secs * 1000).toISOString(), secs, n * 6, n, meta.type, meta.genres);
            for (let k = 0; k < n; k++) q.run('INSERT INTO chapter_reads (user_id, title_id, chapter_id, session_id, content_type, genres, read_at) VALUES (?,?,?,?,?,?,?)',
              u, ch.title_id, ch.id, sid, meta.type, meta.genres, new Date(start.getTime() + (k + 1) * (secs / n) * 1000).toISOString());
          }
        }
      }
    });
  }
  console.log('[seed] Demo accounts: alice / bob / chiyo — password "kimoto-demo"');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
