import { q, json } from '../db/index.js';

/** Server-relevant defaults. The client stores additional UI prefs in the same document. */
export const DEFAULT_PREFS = {
  onboarded: false,
  contentTypes: ['manga', 'manhwa', 'manhua', 'webtoon', 'novel'],
  favoriteGenres: [] as string[],
  language: 'en',
  chapterLanguages: ['en'],
  contentRating: ['safe', 'suggestive'],
  notifications: {
    categories: { chapter: true, author: true, friend: true, follow: true, message: true, reply: true, reaction: true, list: true, community: true, system: true },
    frequency: 'instant', // instant | hourly | daily
    browser: true,
    push: false,
    sound: false,
  },
  privacy: {
    allowMessages: 'everyone', // everyone | friends | none
    allowFriendRequests: true,
    showOnline: true,
    readReceipts: true,
    typingIndicators: true,
    showInRankings: true,
    showActivityInFeed: true,
  },
  analytics: { enabled: true },
  discord: { enabled: false, hideTitle: false, hideChapter: false, hideDuration: false },
};
export type Prefs = typeof DEFAULT_PREFS & Record<string, any>;

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
export function deepMerge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function getPrefs(userId: string): Prefs {
  const row = q.get<{ data: string }>('SELECT data FROM preferences WHERE user_id = ?', userId);
  return deepMerge(DEFAULT_PREFS, json(row?.data, {})) as Prefs;
}

export function patchPrefs(userId: string, patch: Record<string, any>): Prefs {
  const row = q.get<{ data: string }>('SELECT data FROM preferences WHERE user_id = ?', userId);
  const merged = deepMerge(json(row?.data, {}), patch);
  const s = JSON.stringify(merged);
  if (s.length > 200_000) throw new Error('Preferences document too large');
  q.run('INSERT INTO preferences (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', userId, s);
  return deepMerge(DEFAULT_PREFS, merged) as Prefs;
}
