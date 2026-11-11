import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Isolated data directory per run — must be set before the app modules load.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimoto-test-'));
process.env.DATA_DIR = dataDir;
process.env.LOCAL_LIBRARY_DIR = path.join(dataDir, 'library');
process.env.KIMOTO_DISABLE_RATE_LIMIT = '1';

let server: Server;
let base = '';

before(async () => {
  const { createApp } = await import('../src/app.js');
  const { ensureSampleLibrary } = await import('../src/sample.js');
  ensureSampleLibrary();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Minimal cookie-aware client. */
function client() {
  let cookie = '';
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'x-kimoto': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, data };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, b: unknown = {}, h?: Record<string, string>) => call('POST', u, b, h),
    put: (u: string, b: unknown = {}) => call('PUT', u, b),
    patch: (u: string, b: unknown = {}) => call('PATCH', u, b),
    del: (u: string, b?: unknown) => call('DELETE', u, b),
  };
}

const enc = encodeURIComponent;
const MANGA = 'local:lanterns-over-kirihara';
const CH1 = 'local:lanterns-over-kirihara/Ch. 001 - The Moving Lantern';

async function register(name: string) {
  const c = client();
  const r = await c.post('/auth/register', { email: `${name}@test.io`, username: name, password: 'password123' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

test('auth: register, me, login, logout, CSRF guard', async () => {
  const a = await register('alice');
  const me = await a.get('/auth/me');
  assert.equal(me.data.user.username, 'alice');
  assert.equal(me.data.user.role, 'admin', 'first account becomes admin');

  const dup = await client().post('/auth/register', { email: 'other@test.io', username: 'ALICE', password: 'password123' });
  assert.equal(dup.status, 409);

  const noHeader = await fetch(`${base}/auth/logout`, { method: 'POST' });
  assert.equal(noHeader.status, 403, 'state-changing request without x-kimoto header is rejected');

  const b = client();
  assert.equal((await b.post('/auth/login', { login: 'alice', password: 'wrong-password' })).status, 401);
  assert.equal((await b.post('/auth/login', { login: 'alice@test.io', password: 'password123' })).status, 200);
  const sessions = await b.get('/auth/sessions');
  assert.equal(sessions.data.length, 2);
  await b.post('/auth/logout');
  assert.equal((await b.get('/auth/me')).data.user, null);
});

test('sources: local search, chapters, pages and path traversal protection', async () => {
  const c = client();
  const s = await c.get('/search?source=local&query=lantern');
  assert.equal(s.data.items[0].id, MANGA);
  const ch = await c.get(`/titles/${enc(MANGA)}/chapters`);
  assert.equal(ch.data.chapters.length, 3);
  const pages = await c.get(`/chapters/${enc(CH1)}/pages`);
  assert.equal(pages.data.kind, 'images');
  assert.equal(pages.data.pages.length, 6);
  const novel = await c.get(`/chapters/${enc('local:the-cartographers-apprentice/Chapter 1.md')}/pages`);
  assert.equal(novel.data.kind, 'text');
  assert.match(novel.data.html, /<h2>Chapter 1/);
  const trav = await fetch(`${base}/sources/local/file/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(trav.status, 400);
});

test('reading: heartbeat capping, completion validation, library sync, stats', async () => {
  const c = await register('reader1');
  await c.get(`/titles/${enc(MANGA)}/chapters`);
  const start = await c.post('/reading/sessions/start', { titleId: MANGA, chapterId: CH1 });
  const sid = start.data.id;
  assert.ok(sid);

  // Claiming an hour of reading one instant later must not be credited.
  await c.post(`/reading/sessions/${sid}/beat`, { activeSeconds: 3600, pagesRead: 2 });

  // Completing immediately is not counted as a validated read...
  const fast = await c.post('/reading/progress', { chapterId: CH1, titleId: MANGA, page: 5, totalPages: 6, completed: true, sessionId: sid });
  assert.equal(fast.data.counted, false);
  assert.equal(fast.data.next.number, 2);

  // ...but completing after plausible reading time is.
  const realNow = Date.now;
  const t0 = realNow();
  mock.method(Date, 'now', () => t0 + 60_000);
  try {
    await c.del('/reading/history', { chapterId: CH1 });
    const ok = await c.post('/reading/progress', { chapterId: CH1, titleId: MANGA, page: 5, totalPages: 6, completed: true, sessionId: sid });
    assert.equal(ok.data.counted, true);
  } finally {
    mock.restoreAll();
  }

  const lib = await c.get('/library');
  assert.equal(lib.data.items[0].entry.status, 'reading', 'reading auto-adds the title');
  assert.equal(lib.data.items[0].entry.progressChapter, 1);

  const stats = await c.get('/stats?range=7d&tz=UTC');
  assert.equal(stats.data.totals.chaptersRead, 1);
  assert.ok(stats.data.totals.totalSeconds <= 10, `credited ${stats.data.totals.totalSeconds}s, should be capped by wall-clock time`);
  assert.equal(stats.data.totals.currentStreak, 1);

  const cont = await c.get('/reading/continue');
  assert.equal(cont.data[0].resume.chapter.number, 2);

  // Analytics opt-out: no session is recorded.
  await c.patch('/settings/prefs', { analytics: { enabled: false } });
  const off = await c.post('/reading/sessions/start', { titleId: MANGA, chapterId: CH1 });
  assert.equal(off.data.id, null);
});

test('library: status transitions, completion fills progress, bulk + filters', async () => {
  const c = await register('libuser');
  const r = await c.put(`/library/${enc('local:the-cartographers-apprentice')}`, { status: 'completed', rating: 9, favorite: true, tags: ['cozy', 'cozy'] });
  assert.equal(r.data.entry.progressChapter, 3, 'completing fills chapter progress');
  assert.ok(r.data.entry.completedAt);
  assert.deepEqual(r.data.entry.tags, ['cozy']);
  await c.put(`/library/${enc(MANGA)}`, { status: 'planning' });
  const f = await c.get('/library?status=completed');
  assert.equal(f.data.items.length, 1);
  assert.equal(f.data.counts.all, 2);
  const meta = await c.get('/library/meta');
  assert.deepEqual(meta.data.tags, ['cozy']);
  await c.post('/library/bulk', { titleIds: [MANGA], patch: { status: 'on_hold' } });
  assert.equal((await c.get(`/library/${enc(MANGA)}`)).data.entry.status, 'on_hold');
});

test('lists: visibility, reorder, share slug, collaboration requires friendship', async () => {
  const owner = await register('lister');
  const other = await register('stranger');
  const l = await owner.post('/lists', { name: 'Hidden Gems', visibility: 'private' });
  await owner.post(`/lists/${l.data.id}/items`, { titleId: MANGA });
  await owner.post(`/lists/${l.data.id}/items`, { titleId: 'local:skyline-courier' });
  assert.equal((await other.get(`/lists/${l.data.id}`)).status, 404, 'private lists are invisible');
  await owner.put(`/lists/${l.data.id}/order`, { titleIds: ['local:skyline-courier', MANGA] });
  await owner.patch(`/lists/${l.data.id}`, { visibility: 'unlisted' });
  const viaSlug = await other.get(`/lists/${l.data.slug}`);
  assert.equal(viaSlug.status, 200);
  assert.equal(viaSlug.data.items[0].title.id, 'local:skyline-courier');
  assert.equal(viaSlug.data.canEdit, false);
  assert.equal((await owner.post(`/lists/${l.data.id}/members`, { username: 'stranger' })).status, 400);
});

test('community: comments, replies notify, spoilers, votes, blocks hide content', async () => {
  const a = await register('commenter');
  const b = await register('replier');
  await a.get(`/titles/${enc(MANGA)}/chapters`);
  const c1 = await a.post('/comments', { targetType: 'chapter', targetId: CH1, body: 'What a twist', spoiler: true });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  const dup = await a.post('/comments', { targetType: 'chapter', targetId: CH1, body: 'What a twist' });
  assert.equal(dup.status, 409, 'duplicate posts are rejected');
  await b.post('/comments', { targetType: 'chapter', targetId: CH1, parentId: c1.data.comment.id, body: 'Agreed!' });
  await b.post(`/comments/${c1.data.comment.id}/vote`, { value: 1 });
  const notes = await a.get('/notifications');
  assert.ok(notes.data.items.some((n: any) => n.kind === 'reply'));
  assert.ok(notes.data.items.some((n: any) => n.kind === 'reaction'));
  const list = await b.get(`/comments?targetType=chapter&targetId=${enc(CH1)}`);
  assert.equal(list.data.comments.find((c: any) => c.id === c1.data.comment.id).spoiler, true);
  assert.equal(list.data.comments.find((c: any) => c.id === c1.data.comment.id).score, 1);
  await b.post('/u/commenter/block', { kind: 'block' });
  const after = await b.get(`/comments?targetType=chapter&targetId=${enc(CH1)}`);
  assert.ok(!after.data.comments.some((c: any) => c.user?.username === 'commenter'));
});

test('social + messaging: friend requests, DMs, privacy and blocking', async () => {
  const a = await register('msga');
  const b = await register('msgb');
  await a.post('/u/msgb/friend');
  assert.equal((await b.get('/friends')).data.incoming[0].username, 'msga');
  await b.post('/u/msga/friend/respond', { accept: true });
  assert.equal((await a.get('/friends')).data.friends.length, 1);

  const conv = await a.post('/messages/conversations', { usernames: ['msgb'] });
  const m = await a.post(`/messages/conversations/${conv.data.id}/messages`, { body: 'hi!' });
  assert.equal(m.data.body, 'hi!');
  const again = await a.post('/messages/conversations', { usernames: ['msgb'] });
  assert.equal(again.data.id, conv.data.id, 'DMs are deduplicated');
  assert.equal((await b.get('/messages/unread')).data.c, 1);
  await b.post(`/messages/conversations/${conv.data.id}/read`);
  assert.equal((await b.get('/messages/unread')).data.c, 0);

  await b.patch('/settings/prefs', { privacy: { allowMessages: 'none' } });
  const c = await register('msgc');
  assert.equal((await c.post('/messages/conversations', { usernames: ['msgb'] })).status, 403);
  await b.post('/u/msga/block');
  assert.equal((await a.post(`/messages/conversations/${conv.data.id}/messages`, { body: 'still there?' })).status, 403);
});

test('sync engine: pulls, pushes and records conflicts instead of overwriting', async () => {
  const { trackers } = await import('../src/services/sync/trackers.js');
  const { fullSync, resolveConflict } = await import('../src/services/sync/engine.js');
  const { q } = await import('../src/db/index.js');
  const c = await register('syncer');
  const uid = (await c.get('/auth/me')).data.user.id;
  // Link the sample titles to fake AniList ids.
  q.run(`UPDATE titles SET links = '{"al":"101"}' WHERE id = ?`, MANGA);
  q.run(`UPDATE titles SET links = '{"al":"202"}' WHERE id = 'local:skyline-courier'`);
  await c.put(`/library/${enc(MANGA)}`, { status: 'reading', progressChapter: 2 });
  await c.put(`/library/${enc('local:skyline-courier')}`, { status: 'reading', progressChapter: 1 });

  let remote = [
    { remoteId: '101', status: 'reading' as const, progress: 1, progressVolumes: 0, score: null, updatedAt: null },
    { remoteId: '202', status: 'reading' as const, progress: 1, progressVolumes: 0, score: null, updatedAt: null },
  ];
  const pushed: any[] = [];
  (trackers as any).anilist = { ...trackers.anilist, list: async () => remote, push: async (_t: string, id: string, e: any) => { pushed.push({ id, ...e }); }, me: async () => ({ favorites: [] }) };
  q.run(`INSERT INTO integrations (user_id, provider, external_id, access_token, settings) VALUES (?, 'anilist', '1', 'tok', '{"mode":"manual"}')`, uid);

  // First sync: 101 differs (local 2 vs remote 1) with no snapshot → conflict, not an overwrite. 202 matches.
  const r1 = await fullSync(uid, 'anilist');
  assert.equal(r1.conflicts, 1);
  assert.equal(r1.unchanged, 1);
  assert.equal((await c.get(`/library/${enc(MANGA)}`)).data.entry.progressChapter, 2, 'local data untouched');

  const conflicts = await c.get('/integrations');
  const conflict = conflicts.data.conflicts[0];
  await resolveConflict(uid, conflict.id, 'merge');
  assert.equal(pushed.at(-1).progress, 2);

  // Remote-only change is pulled.
  remote = remote.map((r) => (r.remoteId === '202' ? { ...r, progress: 2 } : { ...r, progress: 2 }));
  const r2 = await fullSync(uid, 'anilist');
  assert.equal(r2.pulled, 1);
  assert.equal((await c.get(`/library/${enc('local:skyline-courier')}`)).data.entry.progressChapter, 2);
});

test('rankings respect the opt-out privacy setting', async () => {
  const anon = client();
  const before = await anon.get('/rankings/chapters?period=all');
  assert.ok(before.data.items.some((i: any) => i.user.username === 'reader1'));
  const { q } = await import('../src/db/index.js');
  const uid = q.get<{ id: string }>(`SELECT id FROM users WHERE username = 'reader1'`)!.id;
  const { patchPrefs } = await import('../src/services/prefs.js');
  patchPrefs(uid, { privacy: { showInRankings: false } });
  const afterOpt = await anon.get('/rankings/chapters?period=all');
  assert.ok(!afterOpt.data.items.some((i: any) => i.user.username === 'reader1'));
});

test('native app: bearer-token auth and CORS for app origins only', async () => {
  const appHeaders = { 'x-kimoto': '1', 'x-kimoto-client': 'app', 'content-type': 'application/json', origin: 'https://localhost' };
  const reg = await fetch(`${base}/auth/register`, { method: 'POST', headers: appHeaders, body: JSON.stringify({ email: 'app@test.io', username: 'appuser', password: 'password123' }) });
  assert.equal(reg.status, 201);
  assert.equal(reg.headers.get('access-control-allow-origin'), 'https://localhost');
  const { token } = await reg.json();
  assert.ok(token, 'app clients receive their session token');

  // Bearer requests work without cookies or the CSRF header.
  const me = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await me.json()).user.username, 'appuser');
  const put = await fetch(`${base}/library/${enc(MANGA)}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'planning' }) });
  assert.equal(put.status, 200);

  // Preflight is answered for app origins, but not for arbitrary websites.
  const pre = await fetch(`${base}/library`, { method: 'OPTIONS', headers: { origin: 'https://localhost', 'access-control-request-method': 'PUT' } });
  assert.equal(pre.status, 204);
  const evil = await fetch(`${base}/auth/me`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  // Web clients never get the token in the body.
  const web = await client().post('/auth/login', { login: 'appuser', password: 'password123' });
  assert.equal(web.data.token, undefined);
});
