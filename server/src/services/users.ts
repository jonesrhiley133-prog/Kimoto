import { q, json } from '../db/index.js';
import { isOnline } from '../realtime.js';
import { getPrefs } from './prefs.js';

export const PROFILE_SECTIONS = ['currentlyReading', 'completed', 'stats', 'favoriteGenres', 'favorites', 'lists', 'activity', 'social', 'integrations', 'library'] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type Visibility = 'public' | 'friends' | 'private';

export const userSelect = `SELECT u.id, u.username, u.display_name, u.role, u.created_at, p.avatar_url, p.banner_url, p.bio, p.accent, p.region,
  p.is_public, p.visibility, p.favorite_genres, p.last_seen_at FROM users u LEFT JOIN profiles p ON p.user_id = u.id`;

export function miniUser(r: any) {
  if (!r) return null;
  return { id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null, role: r.role };
}

export function getMini(userId: string) {
  return miniUser(q.get(`${userSelect} WHERE u.id = ?`, userId));
}

export function areFriends(a: string, b: string) {
  return !!q.get(`SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`, a, b, b, a);
}
export function isBlocked(by: string, target: string) {
  return !!q.get(`SELECT 1 FROM blocks WHERE user_id = ? AND target_id = ? AND kind = 'block'`, by, target);
}
export function eitherBlocked(a: string, b: string) {
  return isBlocked(a, b) || isBlocked(b, a);
}
/** Ids hidden from `viewer` (users they blocked or muted, and users who blocked them). */
export function hiddenUserIds(viewer?: string): string[] {
  if (!viewer) return [];
  return q.all<{ id: string }>(`SELECT target_id id FROM blocks WHERE user_id = ? UNION SELECT user_id id FROM blocks WHERE target_id = ? AND kind = 'block'`, viewer, viewer).map((r) => r.id);
}

export function sectionVisibility(row: any): Record<ProfileSection, Visibility> {
  const v = json<Record<string, Visibility>>(row.visibility, {});
  return Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, v[s] ?? 'public'])) as Record<ProfileSection, Visibility>;
}

/** Can `viewerId` see section `s` of the profile in `row`? */
export function canSee(row: any, s: ProfileSection, viewerId?: string) {
  if (viewerId === row.id) return true;
  if (!row.is_public && !(viewerId && areFriends(viewerId, row.id))) return false;
  const v = sectionVisibility(row)[s];
  if (v === 'public') return true;
  if (v === 'friends') return !!viewerId && areFriends(viewerId, row.id);
  return false;
}

export function presence(userId: string) {
  const prefs = getPrefs(userId);
  if (!prefs.privacy.showOnline) return { online: false, lastSeenAt: null };
  const row = q.get<{ last_seen_at: string }>('SELECT last_seen_at FROM profiles WHERE user_id = ?', userId);
  return { online: isOnline(userId), lastSeenAt: row?.last_seen_at ?? null };
}
