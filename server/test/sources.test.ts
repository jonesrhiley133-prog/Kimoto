import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'kimoto-src-'));

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => mock.restoreAll());

test('official links: extracted from markdown, labeled, and only for known platforms', async () => {
  const { extractOfficialLinks, cleanDescription, officialLabel } = await import('../src/sources/official.js');
  const md = 'Story text.\n\n**Official Translations:**  \nRead for FREE on Manga Plus ([English](https://mangaplus.shueisha.co.jp/titles/100020)), '
    + '[Shonen Jump Plus](https://shonenjumpplus.com/episode/1), [some scan site](https://example-scans.net/x), [Kakao Page](https://page.kakao.com/content/1)';
  const links = extractOfficialLinks(md);
  assert.deepEqual(links, {
    'official:MANGA Plus (English)': 'https://mangaplus.shueisha.co.jp/titles/100020',
    'official:Shonen Jump+': 'https://shonenjumpplus.com/episode/1',
    'official:KakaoPage': 'https://page.kakao.com/content/1',
  });
  assert.equal(cleanDescription(md), 'Story text.', 'the link directory is removed from the description');
  assert.equal(officialLabel('VIZ', 'English'), 'VIZ (English)');
  assert.equal(officialLabel('WEBTOON', 'Webtoon'), 'WEBTOON');
});

test('MangaUpdates: series mapping (real response shape)', async () => {
  mock.method(globalThis, 'fetch', async () => jsonResponse(fixture('mangaupdates-series.json')));
  const { mangaupdates } = await import('../src/sources/mangaupdates.js');
  const t = await mangaupdates.getTitle('55099564912');
  assert.equal(t.title, 'One Piece');
  assert.equal(t.type, 'manga');
  assert.equal(t.status, 'ongoing');
  assert.equal(t.demographic, 'shounen');
  assert.equal(t.year, 1997);
  assert.deepEqual(t.authors, ['ODA Eiichiro']);
  assert.equal(t.links?.mu, 'pb8uwds');
  assert.equal(t.links?.['official:MANGA Plus (English)'], 'https://mangaplus.shueisha.co.jp/titles/100020');
  assert.ok(!t.description?.includes('](http'), 'markdown links are stripped from the description');
});

test('MangaUpdates: search request honors filters and hides adult genres by default', async () => {
  let sent: any = null;
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return jsonResponse({ total_hits: 1, results: [{ record: fixture('mangaupdates-series.json') }] });
  });
  const { mangaupdates } = await import('../src/sources/mangaupdates.js');
  const r = await mangaupdates.search({ query: 'one piece unique-1', types: ['manhwa', 'novel'], genres: ['Romance'], limit: 10, offset: 10 });
  assert.equal(r.items.length, 1);
  assert.deepEqual(sent.type, ['Manhwa', 'Novel']);
  assert.deepEqual(sent.genre, ['Romance']);
  assert.equal(sent.orderby, 'score');
  assert.equal(sent.page, 2);
  assert.equal(sent.perpage, 10);
  for (const g of ['Hentai', 'Smut', 'Adult', 'Lolicon']) assert.ok(sent.exclude_genre.includes(g), `${g} excluded`);
  await mangaupdates.search({ sort: 'rating', contentRating: ['safe', 'suggestive', 'erotica'], limit: 5, offset: 0 });
  assert.equal(sent.orderby, 'rating');
  assert.ok(!sent.exclude_genre.includes('Hentai') && sent.exclude_genre.includes('Lolicon'), 'opt-in allows adult genres, never Lolicon');
});

test('Kitsu: search mapping, tracker links and 18+ filtering (real response shape)', async () => {
  const body = fixture('kitsu-search.json');
  body.data[1].attributes.ageRating = 'R18';
  let requested = '';
  mock.method(globalThis, 'fetch', async (url: string) => { requested = url; return jsonResponse(body); });
  const { kitsu_ } = await import('../src/sources/kitsu.js');
  const r = await kitsu_.search({ query: 'frieren', types: ['manga'], limit: 50, offset: 0 });
  assert.match(requested, /page%5Blimit%5D=20/, 'page size is capped at Kitsu’s maximum');
  assert.match(requested, /filter%5Bsubtype%5D=manga%2Coneshot%2Coel/);
  assert.equal(r.items.length, 1, 'R18 entries are hidden unless the user allows them');
  const t = r.items[0];
  assert.equal(t.title, 'Frieren: Beyond Journey’s End');
  assert.equal(t.links?.al, '118586');
  assert.equal(t.links?.mal, '126287');
  assert.ok(t.genres?.includes('Fantasy') && !t.genres?.includes('Shounen'));
  assert.equal(t.demographic, 'shounen');
});

test('AniList: STREAMING external links become official links', async () => {
  const { anilistToMeta } = await import('../src/sources/anilist.js');
  const m = anilistToMeta({
    id: 30013, idMal: 13, format: 'MANGA', countryOfOrigin: 'JP', status: 'RELEASING', title: { english: 'One Piece', romaji: 'ONE PIECE' },
    externalLinks: [
      { url: 'https://mangaplus.shueisha.co.jp/titles/100020', site: 'MANGA Plus', type: 'STREAMING', language: 'English' },
      { url: 'https://twitter.com/Eiichiro_Staff', site: 'Twitter', type: 'SOCIAL', language: 'Japanese' },
    ],
  });
  assert.deepEqual(Object.keys(m.links ?? {}).filter((k) => k.startsWith('official:')), ['official:MANGA Plus (English)']);
  assert.equal(m.links?.al, '30013');
});
