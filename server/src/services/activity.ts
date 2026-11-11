import { q, json } from '../db/index.js';
import { getPrefs } from './prefs.js';
import { toTitle } from '../sources/registry.js';

export type ActivityKind = 'started' | 'completed' | 'rated' | 'reviewed' | 'list_created' | 'list_added' | 'favorited' | 'followed' | 'dropped';

export function logActivity(userId: string, kind: ActivityKind, titleId: string | null, data: Record<string, unknown> = {}, targetId?: string) {
  if (!getPrefs(userId).privacy.showActivityInFeed) return;
  // Collapse duplicates within 10 minutes (e.g. toggling a status back and forth).
  const dup = q.get(`SELECT id FROM activity WHERE user_id = ? AND kind = ? AND COALESCE(title_id,'') = COALESCE(?, '') AND COALESCE(target_id,'') = COALESCE(?, '')
                       AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`, userId, kind, titleId, targetId ?? null);
  if (dup) {
    q.run('UPDATE activity SET data = ?, created_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', JSON.stringify(data), dup.id);
    return;
  }
  q.run('INSERT INTO activity (user_id, kind, title_id, target_id, data) VALUES (?,?,?,?,?)', userId, kind, titleId, targetId ?? null, JSON.stringify(data));
}

export function toActivity(r: any) {
  return {
    id: r.id, kind: r.kind, createdAt: r.created_at, data: json(r.data, {}), targetId: r.target_id,
    user: { id: r.user_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
    title: r.t_id ? toTitle({ id: r.t_id, source: r.t_source, source_id: r.t_source_id, type: r.t_type, title: r.t_title, cover_url: r.t_cover, alt_titles: '[]', authors: '[]', artists: '[]', genres: '[]', tags: '[]', languages: '[]', links: '{}', description: '' }) : null,
  };
}

export const ACTIVITY_SELECT = `
  SELECT a.*, u.username, u.display_name, p.avatar_url,
         t.id t_id, t.source t_source, t.source_id t_source_id, t.type t_type, t.title t_title, t.cover_url t_cover
    FROM activity a JOIN users u ON u.id = a.user_id LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN titles t ON t.id = a.title_id`;
