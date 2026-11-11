import { Router } from 'express';
import { z } from 'zod';
import { q, json, now } from '../db/index.js';
import { h, body, notFound, bad } from '../lib/http.js';
import { requireAuth, me } from '../lib/auth.js';
import { id } from '../lib/util.js';
import { rateLimit } from '../lib/rateLimit.js';
import { config } from '../config.js';
import { toTitle } from '../sources/registry.js';
import { trackers } from '../services/sync/trackers.js';
import { fullSync, resolveConflict, syncSettings, DEFAULT_SYNC } from '../services/sync/engine.js';

export const integrations = Router();

integrations.get('/', requireAuth, h((req) => {
  const uid = me(req).id;
  return {
    providers: Object.values(trackers).map((t) => {
      const row = q.get('SELECT * FROM integrations WHERE user_id = ? AND provider = ?', uid, t.id);
      return {
        id: t.id, name: t.name, configured: t.configured(),
        connected: !!row, account: row ? { id: row.external_id, name: row.external_name, avatarUrl: row.avatar_url } : null,
        lastSyncAt: row?.last_sync_at ?? null, lastError: row?.last_error ?? null, settings: row ? syncSettings(row) : DEFAULT_SYNC,
        linkedEntries: row ? q.get<{ c: number }>('SELECT COUNT(*) c FROM integration_snapshots WHERE user_id = ? AND provider = ?', uid, t.id)!.c : 0,
      };
    }),
    conflicts: q.all(`SELECT c.*, t.* , c.id AS conflict_id FROM sync_conflicts c JOIN titles t ON t.id = c.title_id WHERE c.user_id = ? AND c.status = 'open' ORDER BY c.created_at DESC`, uid)
      .map((c) => ({ id: c.conflict_id, provider: c.provider, local: json(c.local, {}), remote: json(c.remote, {}), title: toTitle(c), createdAt: c.created_at })),
  };
}));

integrations.get('/:provider/connect', requireAuth, h((req, res) => {
  const t = trackers[req.params.provider];
  if (!t) throw notFound();
  if (!t.configured()) throw bad(`${t.name} isn't configured on this server. Set ${t.id === 'mal' ? 'MAL_CLIENT_ID' : 'ANILIST_CLIENT_ID and ANILIST_CLIENT_SECRET'} in .env.`);
  const state = id(32);
  const verifier = id(96); // PKCE verifier (MAL uses the "plain" method, 43–128 chars)
  q.run(`DELETE FROM oauth_states WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`);
  q.run('INSERT INTO oauth_states (state, user_id, provider, verifier) VALUES (?,?,?,?)', state, me(req).id, t.id, verifier);
  res.redirect(t.authorizeUrl(state, verifier));
}));

integrations.get('/:provider/callback', h(async (req, res) => {
  const t = trackers[req.params.provider];
  const back = (qs: string) => res.redirect(`${config.publicUrl}/settings/integrations?${qs}`);
  if (!t) return back('error=unknown_provider');
  const { code, state, error } = req.query as Record<string, string>;
  if (error) return back(`error=${encodeURIComponent(error)}`);
  const st = q.get('SELECT * FROM oauth_states WHERE state = ? AND provider = ?', state ?? '', t.id);
  if (!st || (req.user && req.user.id !== st.user_id)) return back('error=invalid_state');
  q.run('DELETE FROM oauth_states WHERE state = ?', state);
  try {
    const tokens = await t.exchange(code, st.verifier);
    const profile = await t.me(tokens.accessToken);
    q.run(`INSERT INTO integrations (user_id, provider, external_id, external_name, avatar_url, access_token, refresh_token, expires_at, settings)
           VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id, provider) DO UPDATE SET external_id = excluded.external_id, external_name = excluded.external_name,
           avatar_url = excluded.avatar_url, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, last_error = NULL`,
    st.user_id, t.id, profile.id, profile.name, profile.avatarUrl, tokens.accessToken, tokens.refreshToken ?? null, tokens.expiresAt ?? null, JSON.stringify(DEFAULT_SYNC));
    back(`connected=${t.id}`);
  } catch (e: any) {
    console.error(`${t.id} oauth failed`, e);
    back(`error=${encodeURIComponent(e.message?.slice(0, 120) ?? 'connection_failed')}`);
  }
}));

integrations.post('/:provider/sync', requireAuth, rateLimit('sync', 4, 1), h(async (req) => {
  const t = trackers[req.params.provider];
  if (!t) throw notFound();
  try {
    return await fullSync(me(req).id, t.id);
  } catch (e: any) {
    q.run('UPDATE integrations SET last_error = ? WHERE user_id = ? AND provider = ?', String(e.message).slice(0, 300), me(req).id, t.id);
    throw bad(`${t.name} sync failed: ${e.message}`);
  }
}));

integrations.patch('/:provider/settings', requireAuth, h((req) => {
  const uid = me(req).id;
  const b = body(z.object({
    mode: z.enum(['auto', 'manual']).optional(), onChapterComplete: z.boolean().optional(), importNew: z.boolean().optional(), exportNew: z.boolean().optional(),
    conflictStrategy: z.enum(['ask', 'prefer_local', 'prefer_remote', 'highest_progress']).optional(), syncRatings: z.boolean().optional(),
  }), req);
  const row = q.get('SELECT settings FROM integrations WHERE user_id = ? AND provider = ?', uid, req.params.provider);
  if (!row) throw notFound('Not connected');
  q.run('UPDATE integrations SET settings = ? WHERE user_id = ? AND provider = ?', JSON.stringify({ ...json(row.settings, {}), ...b }), uid, req.params.provider);
  return { ok: true };
}));

integrations.delete('/:provider', requireAuth, h((req) => {
  const uid = me(req).id;
  q.run('DELETE FROM integrations WHERE user_id = ? AND provider = ?', uid, req.params.provider);
  q.run('DELETE FROM integration_snapshots WHERE user_id = ? AND provider = ?', uid, req.params.provider);
  q.run(`DELETE FROM sync_conflicts WHERE user_id = ? AND provider = ?`, uid, req.params.provider);
  return { ok: true };
}));

integrations.post('/conflicts/:id/resolve', requireAuth, h(async (req) => {
  const b = body(z.object({ choice: z.enum(['local', 'remote', 'merge']) }), req);
  try {
    return { result: await resolveConflict(me(req).id, req.params.id, b.choice) };
  } catch (e: any) {
    throw bad(e.message);
  }
}));

/** Export the library as MyAnimeList-compatible XML (importable on MAL and AniList). */
integrations.get('/export/mal.xml', requireAuth, h((req, res) => {
  const uid = me(req).id;
  const STATUS: Record<string, string> = { reading: 'Reading', rereading: 'Reading', completed: 'Completed', planning: 'Plan to Read', on_hold: 'On-Hold', dropped: 'Dropped' };
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
  const rows = q.all('SELECT l.*, t.title, t.links FROM library_entries l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ?', uid);
  const items = rows.map((r) => {
    const malId = json<Record<string, string>>(r.links, {}).mal ?? '0';
    return `  <manga>
    <manga_mangadb_id>${esc(malId)}</manga_mangadb_id>
    <manga_title><![CDATA[${r.title.replace(/]]>/g, '')}]]></manga_title>
    <my_read_volumes>${r.progress_volume}</my_read_volumes>
    <my_read_chapters>${Math.floor(r.progress_chapter)}</my_read_chapters>
    <my_start_date>${r.started_at?.slice(0, 10) ?? '0000-00-00'}</my_start_date>
    <my_finish_date>${r.completed_at?.slice(0, 10) ?? '0000-00-00'}</my_finish_date>
    <my_score>${r.rating ?? 0}</my_score>
    <my_status>${STATUS[r.status]}</my_status>
    <my_comments><![CDATA[${r.notes.replace(/]]>/g, '')}]]></my_comments>
    <my_times_read>${r.reread_count}</my_times_read>
    <my_reread_value></my_reread_value>
    <my_tags><![CDATA[${json<string[]>(r.tags, []).join(', ')}]]></my_tags>
    <update_on_import>1</update_on_import>
  </manga>`;
  });
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kimoto-mangalist-${now().slice(0, 10)}.xml"`);
  res.send(`<?xml version="1.0" encoding="UTF-8" ?>\n<myanimelist>\n  <myinfo><user_export_type>2</user_export_type><user_total_manga>${rows.length}</user_total_manga></myinfo>\n${items.join('\n')}\n</myanimelist>\n`);
}));
