import { q } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/util.js';
import { take } from '../lib/rateLimit.js';

const recent = new Map<string, number>(); // userId+bodyhash -> timestamp

/**
 * Spam and abuse checks run before any user-generated post is stored.
 * Returns { hidden } when a word filter says the post should be held for review.
 */
export function checkPost(user: { id: string; created_at?: string }, text: string, kind: string) {
  if (!take(`post:${kind}:${user.id}`, 8, 4)) throw new HttpError(429, "You're posting very quickly — take a breather and try again.");
  const key = `${user.id}:${sha256(text.toLowerCase().replace(/\s+/g, ' '))}`;
  const last = recent.get(key);
  if (last && Date.now() - last < 10 * 60_000) throw new HttpError(409, 'You already posted that.');
  recent.set(key, Date.now());
  if (recent.size > 20000) recent.clear();

  const created = q.get<{ created_at: string }>('SELECT created_at FROM users WHERE id = ?', user.id)?.created_at;
  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (created && Date.now() - Date.parse(created) < 24 * 3600_000 && links > 1) throw new HttpError(403, 'New accounts can include at most one link per post for their first day.');
  if (links > 5) throw new HttpError(403, 'Too many links in one post.');

  let hidden = false;
  for (const f of q.all<{ pattern: string; action: string }>('SELECT pattern, action FROM word_filters')) {
    let re: RegExp;
    try { re = new RegExp(f.pattern, 'i'); } catch { continue; }
    if (re.test(text)) {
      if (f.action === 'block') throw new HttpError(400, 'Your post contains language that is not allowed by the community guidelines.');
      hidden = true;
    }
  }
  return { hidden };
}

export function modLog(moderatorId: string, action: string, targetType?: string, targetId?: string, details?: string) {
  q.run('INSERT INTO mod_log (moderator_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)', moderatorId, action, targetType ?? null, targetId ?? null, details ?? null);
}
