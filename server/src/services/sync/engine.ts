import { q, tx, now, json } from '../../db/index.js';
import { id } from '../../lib/util.js';
import { upsertTitle } from '../../sources/registry.js';
import { notify } from '../notify.js';
import { trackers, anilistByMalIds, type LocalStatus, type RemoteEntry, type Tokens } from './trackers.js';

/**
 * Two-way sync between the Kimoto library and MAL/AniList.
 *
 * For every entry we keep a snapshot of the remote state as of the last successful sync. On each
 * sync we compare local and remote against that snapshot:
 *   - only remote changed  → apply remote locally
 *   - only local changed   → push local to remote
 *   - both changed, differ → record a conflict for the user to resolve (or apply their chosen strategy)
 * Nothing is overwritten without either a clear single-sided change or the user's decision.
 */
export interface SyncSettings {
  mode: 'auto' | 'manual';
  onChapterComplete: boolean;
  importNew: boolean; // add remote-only entries to the local library
  exportNew: boolean; // push local-only entries to the remote list
  conflictStrategy: 'ask' | 'prefer_local' | 'prefer_remote' | 'highest_progress';
  syncRatings: boolean;
}
export const DEFAULT_SYNC: SyncSettings = { mode: 'auto', onChapterComplete: true, importNew: true, exportNew: true, conflictStrategy: 'ask', syncRatings: true };

type Comparable = { status: LocalStatus; progress: number; progressVolumes: number; score: number | null };
const differs = (a: Comparable, b: Comparable, ratings: boolean) =>
  a.status !== b.status || Math.floor(a.progress) !== Math.floor(b.progress) || a.progressVolumes !== b.progressVolumes || (ratings && (a.score ?? null) !== (b.score ?? null));

const fromLocal = (e: any): Comparable => ({ status: e.status, progress: e.progress_chapter, progressVolumes: e.progress_volume, score: e.rating ?? null });

export function integrationRow(userId: string, provider: string) {
  return q.get('SELECT * FROM integrations WHERE user_id = ? AND provider = ?', userId, provider);
}
export const syncSettings = (row: any): SyncSettings => ({ ...DEFAULT_SYNC, ...json(row?.settings, {}) });

async function token(row: any): Promise<string> {
  const t = trackers[row.provider];
  if (row.expires_at && Date.parse(row.expires_at) - Date.now() < 5 * 60_000 && t.refresh && row.refresh_token) {
    const fresh: Tokens = await t.refresh({ accessToken: row.access_token, refreshToken: row.refresh_token });
    q.run('UPDATE integrations SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE user_id = ? AND provider = ?',
      fresh.accessToken, fresh.refreshToken ?? null, fresh.expiresAt ?? null, row.user_id, row.provider);
    return fresh.accessToken;
  }
  return row.access_token;
}

function remoteIdFor(userId: string, provider: string, titleId: string): string | null {
  const snap = q.get<{ remote_id: string }>('SELECT remote_id FROM integration_snapshots WHERE user_id = ? AND provider = ? AND title_id = ?', userId, provider, titleId);
  if (snap) return snap.remote_id;
  const t = q.get<{ links: string }>('SELECT links FROM titles WHERE id = ?', titleId);
  return json<Record<string, string>>(t?.links, {})[trackers[provider].linkKey] ?? null;
}

function saveSnapshot(userId: string, provider: string, titleId: string, remoteId: string, data: Comparable) {
  q.run(`INSERT INTO integration_snapshots (user_id, provider, title_id, remote_id, data, synced_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id, provider, title_id) DO UPDATE SET remote_id = excluded.remote_id, data = excluded.data, synced_at = excluded.synced_at`,
  userId, provider, titleId, remoteId, JSON.stringify(data), now());
}

function applyLocal(userId: string, titleId: string, r: Comparable, ratings: boolean) {
  const existing = q.get('SELECT 1 FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);
  const ts = now();
  if (!existing) q.run('INSERT INTO library_entries (user_id, title_id, status) VALUES (?, ?, ?)', userId, titleId, r.status);
  q.run(`UPDATE library_entries SET status = ?, progress_chapter = ?, progress_volume = ?, rating = CASE WHEN ? THEN ? ELSE rating END, updated_at = ?,
           started_at = COALESCE(started_at, CASE WHEN ? IN ('reading','rereading','completed') THEN ? END),
           completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END
         WHERE user_id = ? AND title_id = ?`,
  r.status, r.progress, r.progressVolumes, ratings ? 1 : 0, r.score, ts, r.status, ts, r.status, ts, userId, titleId);
}

/** Push one entry (debounced from library changes). */
export async function pushEntry(userId: string, provider: string, titleId: string) {
  const row = integrationRow(userId, provider);
  if (!row) return;
  const s = syncSettings(row);
  const remoteId = remoteIdFor(userId, provider, titleId);
  if (!remoteId) return; // title not linked to this tracker
  const e = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);
  if (!e) return;
  const local = fromLocal(e);
  const tok = await token(row);
  await trackers[provider].push(tok, remoteId, { ...local, score: s.syncRatings ? local.score : null });
  saveSnapshot(userId, provider, titleId, remoteId, local);
}

const timers = new Map<string, NodeJS.Timeout>();
/** Called after any local library change. */
export function queueSync(userId: string, titleId: string, isProgress: boolean) {
  const rows = q.all('SELECT * FROM integrations WHERE user_id = ?', userId);
  for (const row of rows) {
    const s = syncSettings(row);
    if (s.mode !== 'auto' && !(isProgress && s.onChapterComplete)) continue;
    const key = `${userId}:${row.provider}:${titleId}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      pushEntry(userId, row.provider, titleId).catch((err) => {
        q.run('UPDATE integrations SET last_error = ? WHERE user_id = ? AND provider = ?', String(err.message ?? err).slice(0, 300), userId, row.provider);
      });
    }, 4000));
  }
}

export interface SyncReport { imported: number; pulled: number; pushed: number; exported: number; conflicts: number; unmatched: string[]; unchanged: number }

export async function fullSync(userId: string, provider: string): Promise<SyncReport> {
  const row = integrationRow(userId, provider);
  if (!row) throw new Error('Not connected');
  const t = trackers[provider];
  const s = syncSettings(row);
  const tok = await token(row);
  const remote = await t.list(tok, row.external_id);
  const report: SyncReport = { imported: 0, pulled: 0, pushed: 0, exported: 0, conflicts: 0, unmatched: [], unchanged: 0 };

  // Map remote entries to local title ids.
  const malMeta = provider === 'mal' ? await anilistByMalIds(remote.filter((r) => !findLocalTitle(userId, provider, r.remoteId)).map((r) => r.remoteId)).catch(() => new Map()) : new Map();
  const seenTitles = new Set<string>();
  const pushes: { titleId: string; remoteId: string; data: Comparable }[] = [];

  for (const r of remote) {
    let titleId = findLocalTitle(userId, provider, r.remoteId);
    if (!titleId) {
      const meta = r.meta ?? malMeta.get(r.remoteId);
      if (!meta) { report.unmatched.push(r.title ?? r.remoteId); continue; }
      titleId = upsertTitle('anilist', meta);
    }
    seenTitles.add(titleId);
    const remoteC: Comparable = { status: r.status, progress: r.progress, progressVolumes: r.progressVolumes, score: r.score };
    const localRow = q.get('SELECT * FROM library_entries WHERE user_id = ? AND title_id = ?', userId, titleId);
    const snapRow = q.get('SELECT * FROM integration_snapshots WHERE user_id = ? AND provider = ? AND title_id = ?', userId, provider, titleId);

    if (!localRow) {
      if (!s.importNew) continue;
      applyLocal(userId, titleId, remoteC, true);
      saveSnapshot(userId, provider, titleId, r.remoteId, remoteC);
      report.imported++;
      continue;
    }
    const localC = fromLocal(localRow);
    if (!differs(localC, remoteC, s.syncRatings)) {
      saveSnapshot(userId, provider, titleId, r.remoteId, remoteC);
      report.unchanged++;
      continue;
    }
    const snap = snapRow ? json<Comparable>(snapRow.data, remoteC) : null;
    const remoteChanged = !snap || differs(remoteC, snap, s.syncRatings);
    const localChanged = !snap || (localRow.updated_at > snapRow.synced_at && differs(localC, snap, s.syncRatings));

    if (remoteChanged && !localChanged) {
      applyLocal(userId, titleId, remoteC, s.syncRatings);
      saveSnapshot(userId, provider, titleId, r.remoteId, remoteC);
      report.pulled++;
    } else if (localChanged && !remoteChanged) {
      pushes.push({ titleId, remoteId: r.remoteId, data: localC });
    } else {
      // Both sides changed (or first sync with differing data): resolve by strategy or ask.
      const resolved = resolveBy(s.conflictStrategy, localC, remoteC);
      if (resolved === 'local') pushes.push({ titleId, remoteId: r.remoteId, data: localC });
      else if (resolved === 'remote') {
        applyLocal(userId, titleId, remoteC, s.syncRatings);
        saveSnapshot(userId, provider, titleId, r.remoteId, remoteC);
        report.pulled++;
      } else {
        const exists = q.get(`SELECT id FROM sync_conflicts WHERE user_id = ? AND provider = ? AND title_id = ? AND status = 'open'`, userId, provider, titleId);
        if (exists) q.run('UPDATE sync_conflicts SET local = ?, remote = ? WHERE id = ?', JSON.stringify(localC), JSON.stringify(remoteC), exists.id);
        else q.run('INSERT INTO sync_conflicts (id, user_id, provider, title_id, remote_id, local, remote) VALUES (?,?,?,?,?,?,?)', id(), userId, provider, titleId, r.remoteId, JSON.stringify(localC), JSON.stringify(remoteC));
        report.conflicts++;
      }
    }
  }

  // Local entries the remote list doesn't have yet.
  if (s.exportNew) {
    for (const e of q.all('SELECT * FROM library_entries WHERE user_id = ?', userId)) {
      if (seenTitles.has(e.title_id)) continue;
      const rid = remoteIdFor(userId, provider, e.title_id);
      if (rid) { pushes.push({ titleId: e.title_id, remoteId: rid, data: fromLocal(e) }); report.exported++; }
    }
  }
  for (const p of pushes) {
    try {
      await t.push(tok, p.remoteId, { ...p.data, score: s.syncRatings ? p.data.score : null });
      saveSnapshot(userId, provider, p.titleId, p.remoteId, p.data);
      report.pushed++;
    } catch (err: any) {
      q.run('UPDATE integrations SET last_error = ? WHERE user_id = ? AND provider = ?', String(err.message).slice(0, 300), userId, provider);
    }
  }
  report.exported = Math.min(report.exported, report.pushed);

  // Favorites import (AniList only — MAL's API doesn't expose them).
  if (provider === 'anilist') {
    const meInfo = await t.me(tok).catch(() => null);
    for (const fav of meInfo?.favorites ?? []) {
      const tid = findLocalTitle(userId, provider, fav);
      if (tid) q.run('UPDATE library_entries SET favorite = 1 WHERE user_id = ? AND title_id = ?', userId, tid);
    }
  }
  q.run('UPDATE integrations SET last_sync_at = ?, last_error = NULL WHERE user_id = ? AND provider = ?', now(), userId, provider);
  if (report.conflicts) notify({ userId, kind: 'system', title: `${t.name} sync needs your input`, body: `${report.conflicts} entr${report.conflicts === 1 ? 'y differs' : 'ies differ'} between Kimoto and ${t.name}.`, link: '/settings/integrations' });
  return report;
}

function findLocalTitle(userId: string, provider: string, remoteId: string): string | null {
  const snap = q.get<{ title_id: string }>('SELECT title_id FROM integration_snapshots WHERE user_id = ? AND provider = ? AND remote_id = ?', userId, provider, remoteId);
  if (snap) return snap.title_id;
  const key = trackers[provider].linkKey;
  // Prefer a readable title the user already has in their library, then any cached title.
  const inLib = q.get<{ id: string }>(`SELECT t.id FROM titles t JOIN library_entries l ON l.title_id = t.id AND l.user_id = ? WHERE json_extract(t.links, '$.' || ?) = ? LIMIT 1`, userId, key, remoteId);
  if (inLib) return inLib.id;
  if (provider === 'anilist' && q.get('SELECT 1 FROM titles WHERE id = ?', `anilist:${remoteId}`)) return `anilist:${remoteId}`;
  return q.get<{ id: string }>(`SELECT id FROM titles WHERE json_extract(links, '$.' || ?) = ? LIMIT 1`, key, remoteId)?.id ?? null;
}

function resolveBy(strategy: SyncSettings['conflictStrategy'], local: Comparable, remote: Comparable): 'local' | 'remote' | 'ask' {
  if (strategy === 'prefer_local') return 'local';
  if (strategy === 'prefer_remote') return 'remote';
  if (strategy === 'highest_progress') return local.progress >= remote.progress ? 'local' : 'remote';
  return 'ask';
}

export async function resolveConflict(userId: string, conflictId: string, choice: 'local' | 'remote' | 'merge') {
  const c = q.get(`SELECT * FROM sync_conflicts WHERE id = ? AND user_id = ? AND status = 'open'`, conflictId, userId);
  if (!c) throw new Error('Conflict not found');
  const local = json<Comparable>(c.local, null as any);
  const remote = json<Comparable>(c.remote, null as any);
  const row = integrationRow(userId, c.provider);
  if (!row) throw new Error('Not connected');
  const s = syncSettings(row);
  let final: Comparable;
  if (choice === 'local') final = local;
  else if (choice === 'remote') final = remote;
  else {
    // Merge: furthest progress wins, the status from whichever side is further along, keep any rating.
    const remoteAhead = remote.progress > local.progress;
    final = {
      status: remoteAhead ? remote.status : local.status,
      progress: Math.max(local.progress, remote.progress),
      progressVolumes: Math.max(local.progressVolumes, remote.progressVolumes),
      score: local.score ?? remote.score,
    };
  }
  tx(() => applyLocal(userId, c.title_id, final, true));
  const tok = await token(row);
  await trackers[c.provider].push(tok, c.remote_id, { ...final, score: s.syncRatings ? final.score : null });
  saveSnapshot(userId, c.provider, c.title_id, c.remote_id, final);
  q.run(`UPDATE sync_conflicts SET status = 'resolved' WHERE id = ?`, c.id);
  return final;
}

export type { RemoteEntry };
