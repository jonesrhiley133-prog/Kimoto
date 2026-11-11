import { config } from '../../config.js';
import { timeoutFetch } from '../../lib/util.js';
import { anilistQuery, anilistToMeta, FIELDS } from '../../sources/anilist.js';
import type { TitleMeta } from '../../sources/types.js';

export type LocalStatus = 'reading' | 'completed' | 'planning' | 'on_hold' | 'dropped' | 'rereading';

export interface RemoteEntry {
  remoteId: string;
  status: LocalStatus;
  progress: number;
  progressVolumes: number;
  score: number | null; // 1–10
  updatedAt: string | null;
  title?: string;
  meta?: TitleMeta; // full metadata when the tracker provides it (AniList)
  malId?: string;
}

export interface Tokens { accessToken: string; refreshToken?: string | null; expiresAt?: string | null }

export interface Tracker {
  id: 'mal' | 'anilist';
  name: string;
  configured(): boolean;
  /** Which `titles.links` key holds this tracker's id. */
  linkKey: 'mal' | 'al';
  authorizeUrl(state: string, verifier: string): string;
  exchange(code: string, verifier: string): Promise<Tokens>;
  refresh?(t: Tokens): Promise<Tokens>;
  me(token: string): Promise<{ id: string; name: string; avatarUrl: string | null; favorites: string[] }>;
  list(token: string, userId: string): Promise<RemoteEntry[]>;
  push(token: string, remoteId: string, e: { status: LocalStatus; progress: number; progressVolumes: number; score: number | null }): Promise<void>;
  remove?(token: string, remoteId: string): Promise<void>;
}

const redirect = (p: string) => `${config.publicUrl}/api/integrations/${p}/callback`;
const expiry = (sec?: number) => (sec ? new Date(Date.now() + sec * 1000).toISOString() : null);

async function ok(res: Response, what: string) {
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  throw new Error(`${what} failed (${res.status}): ${text.slice(0, 200)}`);
}

// ---------------- MyAnimeList (API v2, OAuth2 + PKCE "plain") ----------------
const MAL_STATUS: Record<string, LocalStatus> = { reading: 'reading', completed: 'completed', plan_to_read: 'planning', on_hold: 'on_hold', dropped: 'dropped' };
const TO_MAL: Record<LocalStatus, string> = { reading: 'reading', rereading: 'reading', completed: 'completed', planning: 'plan_to_read', on_hold: 'on_hold', dropped: 'dropped' };

async function malToken(params: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: config.mal.clientId!, ...(config.mal.clientSecret ? { client_secret: config.mal.clientSecret } : {}), ...params });
  const res = await ok(await timeoutFetch('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }), 'MAL token');
  const j: any = await res.json();
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: expiry(j.expires_in) };
}

export const mal: Tracker = {
  id: 'mal', name: 'MyAnimeList', linkKey: 'mal',
  configured: () => !!config.mal.clientId,
  authorizeUrl: (state, verifier) => `https://myanimelist.net/v1/oauth2/authorize?${new URLSearchParams({
    response_type: 'code', client_id: config.mal.clientId!, state, code_challenge: verifier, code_challenge_method: 'plain', redirect_uri: redirect('mal'),
  })}`,
  exchange: (code, verifier) => malToken({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect('mal') }),
  refresh: (t) => malToken({ grant_type: 'refresh_token', refresh_token: t.refreshToken ?? '' }),
  async me(token) {
    const res = await ok(await timeoutFetch('https://api.myanimelist.net/v2/users/@me', { headers: { Authorization: `Bearer ${token}` } }), 'MAL profile');
    const j: any = await res.json();
    return { id: String(j.id), name: j.name, avatarUrl: j.picture ?? null, favorites: [] }; // MAL API v2 does not expose favorites
  },
  async list(token) {
    const out: RemoteEntry[] = [];
    let url: string | null = `https://api.myanimelist.net/v2/users/@me/mangalist?${new URLSearchParams({
      fields: 'list_status{status,num_chapters_read,num_volumes_read,score,is_rereading,updated_at},num_chapters,media_type', limit: '1000', nsfw: 'true',
    })}`;
    while (url) {
      const res = await ok(await timeoutFetch(url, { headers: { Authorization: `Bearer ${token}` } }), 'MAL list');
      const j: any = await res.json();
      for (const d of j.data) {
        const s = d.list_status;
        out.push({
          remoteId: String(d.node.id), malId: String(d.node.id), title: d.node.title,
          status: s.is_rereading ? 'rereading' : MAL_STATUS[s.status] ?? 'planning',
          progress: s.num_chapters_read ?? 0, progressVolumes: s.num_volumes_read ?? 0, score: s.score ? s.score : null, updatedAt: s.updated_at ?? null,
        });
      }
      url = j.paging?.next ?? null;
    }
    return out;
  },
  async push(token, remoteId, e) {
    const body = new URLSearchParams({
      status: TO_MAL[e.status], is_rereading: String(e.status === 'rereading'), num_chapters_read: String(Math.floor(e.progress)),
      num_volumes_read: String(e.progressVolumes), score: String(e.score ?? 0),
    });
    await ok(await timeoutFetch(`https://api.myanimelist.net/v2/manga/${encodeURIComponent(remoteId)}/my_list_status`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    }), 'MAL update');
  },
  async remove(token, remoteId) {
    await timeoutFetch(`https://api.myanimelist.net/v2/manga/${encodeURIComponent(remoteId)}/my_list_status`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  },
};

// ---------------- AniList (OAuth2 authorization code, GraphQL) ----------------
const AL_STATUS: Record<string, LocalStatus> = { CURRENT: 'reading', COMPLETED: 'completed', PLANNING: 'planning', PAUSED: 'on_hold', DROPPED: 'dropped', REPEATING: 'rereading' };
const TO_AL: Record<LocalStatus, string> = { reading: 'CURRENT', completed: 'COMPLETED', planning: 'PLANNING', on_hold: 'PAUSED', dropped: 'DROPPED', rereading: 'REPEATING' };

export const anilistTracker: Tracker = {
  id: 'anilist', name: 'AniList', linkKey: 'al',
  configured: () => !!(config.anilist.clientId && config.anilist.clientSecret),
  authorizeUrl: (state) => `https://anilist.co/api/v2/oauth/authorize?${new URLSearchParams({ client_id: config.anilist.clientId!, redirect_uri: redirect('anilist'), response_type: 'code', state })}`,
  async exchange(code) {
    const res = await ok(await timeoutFetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: config.anilist.clientId, client_secret: config.anilist.clientSecret, redirect_uri: redirect('anilist'), code }),
    }), 'AniList token');
    const j: any = await res.json();
    return { accessToken: j.access_token, refreshToken: null, expiresAt: expiry(j.expires_in) };
  },
  async me(token) {
    const d = await anilistQuery('{ Viewer { id name avatar { medium } favourites { manga(perPage: 50) { nodes { id } } } } }', {}, token, false);
    return { id: String(d.Viewer.id), name: d.Viewer.name, avatarUrl: d.Viewer.avatar?.medium ?? null, favorites: d.Viewer.favourites.manga.nodes.map((n: any) => String(n.id)) };
  },
  async list(token, userId) {
    const d = await anilistQuery(`query ($userId: Int) { MediaListCollection(userId: $userId, type: MANGA) { lists { entries {
        mediaId status progress progressVolumes score(format: POINT_10) updatedAt media { ${FIELDS} } } } } }`, { userId: Number(userId) }, token, false);
    const seen = new Set<string>();
    return d.MediaListCollection.lists.flatMap((l: any) => l.entries).filter((e: any) => !seen.has(String(e.mediaId)) && seen.add(String(e.mediaId))).map((e: any) => ({
      remoteId: String(e.mediaId), status: AL_STATUS[e.status] ?? 'planning', progress: e.progress ?? 0, progressVolumes: e.progressVolumes ?? 0,
      score: e.score ? Math.round(e.score) : null, updatedAt: e.updatedAt ? new Date(e.updatedAt * 1000).toISOString() : null,
      meta: anilistToMeta(e.media), title: e.media.title.english ?? e.media.title.romaji, malId: e.media.idMal ? String(e.media.idMal) : undefined,
    }));
  },
  async push(token, remoteId, e) {
    await anilistQuery(`mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $scoreRaw: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes, scoreRaw: $scoreRaw) { id } }`,
    { mediaId: Number(remoteId), status: TO_AL[e.status], progress: Math.floor(e.progress), progressVolumes: e.progressVolumes, scoreRaw: e.score ? e.score * 10 : 0 }, token, false);
  },
};

export const trackers: Record<string, Tracker> = { mal, anilist: anilistTracker };

/** Resolve MAL ids to AniList metadata (public API) so MAL imports get proper title records. */
export async function anilistByMalIds(malIds: string[]): Promise<Map<string, TitleMeta>> {
  const out = new Map<string, TitleMeta>();
  for (let i = 0; i < malIds.length; i += 50) {
    const chunk = malIds.slice(i, i + 50).map(Number);
    const d = await anilistQuery(`query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: MANGA) { ${FIELDS} } } }`, { ids: chunk });
    for (const m of d.Page.media) if (m.idMal) out.set(String(m.idMal), anilistToMeta(m));
  }
  return out;
}
