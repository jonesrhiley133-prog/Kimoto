import { Router } from 'express';
import { z } from 'zod';
import { q, tx, now } from '../db/index.js';
import { h, body, query, notFound, forbidden, bad } from '../lib/http.js';
import { requireAuth, requireNotBanned, requireMod, me } from '../lib/auth.js';
import { id, clean } from '../lib/util.js';
import { take } from '../lib/rateLimit.js';
import { emitToConversation, emitToUser, joinConversationRoom, leaveConversationRoom } from '../realtime.js';
import { notify } from '../services/notify.js';
import { getPrefs } from '../services/prefs.js';
import { areFriends, eitherBlocked, miniUser, presence, userSelect } from '../services/users.js';

export const messages = Router();
messages.use(requireAuth);

function member(convId: string, uid: string) {
  const m = q.get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', convId, uid);
  if (!m) throw notFound('Conversation not found');
  return m;
}

function canMessage(from: string, to: string) {
  if (eitherBlocked(from, to)) return false;
  const p = getPrefs(to).privacy.allowMessages;
  return p === 'everyone' || (p === 'friends' && areFriends(from, to));
}

function messageDTO(m: any, viewer: string) {
  const reactions = q.all<{ emoji: string; n: number; mine: number }>('SELECT emoji, COUNT(*) n, SUM(user_id = ?) mine FROM message_reactions WHERE message_id = ? GROUP BY emoji', viewer, m.id);
  const reply = m.reply_to ? q.get('SELECT m.id, m.body, m.deleted, u.display_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?', m.reply_to) : null;
  return {
    id: m.id, conversationId: m.conversation_id, userId: m.user_id, body: m.deleted ? '' : m.body, deleted: !!m.deleted,
    attachmentUrl: m.deleted ? null : m.attachment_url, attachmentKind: m.attachment_kind, editedAt: m.edited_at, createdAt: m.created_at,
    replyTo: reply ? { id: reply.id, body: reply.deleted ? '' : reply.body.slice(0, 120), author: reply.display_name } : null,
    reactions: reactions.map((r) => ({ emoji: r.emoji, count: r.n, mine: !!r.mine })),
  };
}

function conversationDTO(c: any, viewer: string) {
  const members = q.all(`${userSelect.replace('SELECT', 'SELECT cm.last_read_at, cm.role AS member_role,')} JOIN conversation_members cm ON cm.user_id = u.id WHERE cm.conversation_id = ?`, c.id);
  const mine = members.find((m) => m.id === viewer);
  const last = q.get('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1', c.id);
  const unread = q.get<{ c: number }>('SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND user_id != ? AND created_at > ? AND deleted = 0', c.id, viewer, mine?.last_read_at ?? '0000')!.c;
  const others = members.filter((m) => m.id !== viewer);
  return {
    id: c.id, kind: c.kind, name: c.kind === 'group' ? c.name : others[0]?.display_name ?? 'Conversation', iconUrl: c.kind === 'group' ? c.icon_url : others[0]?.avatar_url ?? null,
    createdBy: c.created_by, lastMessageAt: c.last_message_at, unread, muted: !!q.get('SELECT muted FROM conversation_members WHERE conversation_id = ? AND user_id = ?', c.id, viewer)?.muted,
    members: members.map((m) => ({
      ...miniUser(m), memberRole: m.member_role, presence: presence(m.id),
      // Read receipts are shared only by users who allow them.
      lastReadAt: getPrefs(m.id).privacy.readReceipts && getPrefs(viewer).privacy.readReceipts ? m.last_read_at : null,
    })),
    lastMessage: last ? { body: last.deleted ? 'Message deleted' : last.body || (last.attachment_url ? '📎 Attachment' : ''), userId: last.user_id, createdAt: last.created_at } : null,
  };
}

messages.get('/conversations', h((req) => {
  const uid = me(req).id;
  return q.all('SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE m.user_id = ? ORDER BY c.last_message_at DESC', uid).map((c) => conversationDTO(c, uid));
}));

messages.get('/unread', h((req) => {
  const uid = me(req).id;
  return q.get<{ c: number }>(`SELECT COUNT(*) c FROM messages msg JOIN conversation_members m ON m.conversation_id = msg.conversation_id
                                WHERE m.user_id = ? AND m.muted = 0 AND msg.user_id != ? AND msg.deleted = 0 AND msg.created_at > COALESCE(m.last_read_at, '0000')`, uid, uid);
}));

messages.post('/conversations', requireNotBanned, h((req) => {
  const u = me(req);
  const b = body(z.object({ usernames: z.array(z.string()).min(1).max(49), name: z.string().max(80).optional() }), req);
  const targets = b.usernames.map((n) => q.get('SELECT id FROM users WHERE username = ?', n)).filter(Boolean) as { id: string }[];
  const ids = [...new Set(targets.map((t) => t.id))].filter((x) => x !== u.id);
  if (!ids.length) throw bad('Pick at least one other person.');
  for (const t of ids) if (!canMessage(u.id, t)) throw forbidden('One of these users is not accepting messages from you.');
  if (ids.length === 1 && !b.name) {
    const key = [u.id, ids[0]].sort().join(':');
    const existing = q.get('SELECT * FROM conversations WHERE dm_key = ?', key);
    if (existing) {
      // Re-add the creator if they had left their side of the DM.
      q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', existing.id, u.id);
      joinConversationRoom(u.id, existing.id);
      return conversationDTO(existing, u.id);
    }
    const cid = id();
    tx(() => {
      q.run(`INSERT INTO conversations (id, kind, created_by, dm_key) VALUES (?, 'dm', ?, ?)`, cid, u.id, key);
      for (const m of [u.id, ids[0]]) q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, m);
    });
    [u.id, ids[0]].forEach((m) => joinConversationRoom(m, cid));
    return conversationDTO(q.get('SELECT * FROM conversations WHERE id = ?', cid), u.id);
  }
  const cid = id();
  tx(() => {
    q.run(`INSERT INTO conversations (id, kind, name, created_by) VALUES (?, 'group', ?, ?)`, cid, clean(b.name ?? 'Group chat'), u.id);
    q.run(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')`, cid, u.id);
    for (const m of ids) q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, m);
  });
  [u.id, ...ids].forEach((m) => joinConversationRoom(m, cid));
  const dto = conversationDTO(q.get('SELECT * FROM conversations WHERE id = ?', cid), u.id);
  ids.forEach((m) => emitToUser(m, 'conversation:new', { id: cid }));
  return dto;
}));

messages.get('/conversations/:id', h((req) => {
  const uid = me(req).id;
  member(req.params.id, uid);
  return conversationDTO(q.get('SELECT * FROM conversations WHERE id = ?', req.params.id), uid);
}));

messages.patch('/conversations/:id', h((req) => {
  const uid = me(req).id;
  const m = member(req.params.id, uid);
  const b = body(z.object({ name: z.string().min(1).max(80).optional(), iconUrl: z.string().max(500).nullable().optional(), muted: z.boolean().optional() }), req);
  if (b.muted !== undefined) q.run('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?', b.muted ? 1 : 0, req.params.id, uid);
  if (b.name || b.iconUrl !== undefined) {
    const c = q.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
    if (c.kind !== 'group') throw bad('Only group chats can be renamed.');
    if (b.name) q.run('UPDATE conversations SET name = ? WHERE id = ?', clean(b.name), c.id);
    if (b.iconUrl !== undefined) q.run('UPDATE conversations SET icon_url = ? WHERE id = ?', b.iconUrl, c.id);
    emitToConversation(c.id, 'conversation:updated', { id: c.id });
  }
  void m;
  return { ok: true };
}));

messages.post('/conversations/:id/members', h((req) => {
  const u = me(req);
  member(req.params.id, u.id);
  const c = q.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (c.kind !== 'group') throw bad('Add people by starting a group chat.');
  const { username } = body(z.object({ username: z.string() }), req);
  const t = q.get('SELECT id FROM users WHERE username = ?', username);
  if (!t) throw notFound('User not found');
  if (!canMessage(u.id, t.id)) throw forbidden('That user is not accepting messages from you.');
  q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', c.id, t.id);
  joinConversationRoom(t.id, c.id);
  emitToUser(t.id, 'conversation:new', { id: c.id });
  emitToConversation(c.id, 'conversation:updated', { id: c.id });
  return { ok: true };
}));

messages.delete('/conversations/:id/members/:userId', h((req) => {
  const uid = me(req).id;
  const m = member(req.params.id, uid);
  const target = req.params.userId === 'me' ? uid : req.params.userId;
  if (target !== uid && m.role !== 'owner') throw forbidden('Only the group owner can remove people.');
  q.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', req.params.id, target);
  leaveConversationRoom(target, req.params.id);
  if (!q.get('SELECT 1 FROM conversation_members WHERE conversation_id = ?', req.params.id)) q.run('DELETE FROM conversations WHERE id = ?', req.params.id);
  else emitToConversation(req.params.id, 'conversation:updated', { id: req.params.id });
  return { ok: true };
}));

messages.get('/conversations/:id/messages', h((req) => {
  const uid = me(req).id;
  member(req.params.id, uid);
  const f = query(z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req);
  const rows = q.all(`SELECT * FROM messages WHERE conversation_id = ? AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC LIMIT ?`, req.params.id, f.before ?? null, f.before ?? null, f.limit);
  return { messages: rows.reverse().map((m) => messageDTO(m, uid)), hasMore: rows.length === f.limit };
}));

messages.post('/conversations/:id/messages', requireNotBanned, h((req) => {
  const u = me(req);
  member(req.params.id, u.id);
  const b = body(z.object({
    body: z.string().max(4000).default(''), replyTo: z.string().optional(),
    attachmentUrl: z.string().max(600).optional(), attachmentKind: z.enum(['image', 'gif']).optional(),
  }), req);
  const text = clean(b.body);
  if (!text && !b.attachmentUrl) throw bad('Message is empty.');
  if (b.attachmentUrl && !b.attachmentUrl.startsWith('/uploads/') && !/^https:\/\/(media\d*\.giphy\.com|media\.tenor\.com|i\.imgur\.com)\//.test(b.attachmentUrl)) throw bad('Attachments must be uploaded images or GIFs from Giphy/Tenor/Imgur.');
  if (!take(`msg:${u.id}`, 20, 30)) throw bad("You're sending messages too quickly.");
  const c = q.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  const others = q.all<{ user_id: string; muted: number }>('SELECT user_id, muted FROM conversation_members WHERE conversation_id = ? AND user_id != ?', c.id, u.id);
  if (c.kind === 'dm' && others[0] && eitherBlocked(u.id, others[0].user_id)) throw forbidden('You cannot message this user.');
  if (b.replyTo && !q.get('SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?', b.replyTo, c.id)) throw bad('Reply target not found');
  const mid = id();
  const ts = now();
  q.run('INSERT INTO messages (id, conversation_id, user_id, body, reply_to, attachment_url, attachment_kind, created_at) VALUES (?,?,?,?,?,?,?,?)',
    mid, c.id, u.id, text, b.replyTo ?? null, b.attachmentUrl ?? null, b.attachmentUrl ? b.attachmentKind ?? 'image' : null, ts);
  q.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', ts, c.id);
  q.run('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', ts, c.id, u.id);
  // A DM partner who had left gets the conversation back when a new message arrives.
  if (c.kind === 'dm') {
    for (const uid of c.dm_key.split(':')) {
      const r = q.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', c.id, uid);
      if (r.changes) joinConversationRoom(uid, c.id);
    }
  }
  const row = q.get('SELECT * FROM messages WHERE id = ?', mid);
  emitToConversation(c.id, 'message', messageDTO(row, u.id));
  for (const o of others) {
    if (o.muted) continue;
    notify({ userId: o.user_id, kind: 'message', title: c.kind === 'group' ? `${u.display_name} in ${c.name}` : u.display_name, body: text.slice(0, 140) || 'Sent an attachment', link: `/messages/${c.id}`, actorId: u.id, data: { conversationId: c.id, silent: true } });
  }
  return messageDTO(row, u.id);
}));

messages.patch('/messages/:id', h((req) => {
  const uid = me(req).id;
  const m = q.get('SELECT * FROM messages WHERE id = ?', req.params.id);
  if (!m || m.user_id !== uid || m.deleted) throw notFound();
  const { body: text } = body(z.object({ body: z.string().min(1).max(4000) }), req);
  q.run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', clean(text), now(), m.id);
  emitToConversation(m.conversation_id, 'message:updated', messageDTO(q.get('SELECT * FROM messages WHERE id = ?', m.id), uid));
  return { ok: true };
}));

messages.delete('/messages/:id', h((req) => {
  const uid = me(req).id;
  const m = q.get('SELECT * FROM messages WHERE id = ?', req.params.id);
  if (!m || m.user_id !== uid) throw notFound();
  q.run("UPDATE messages SET deleted = 1, body = '', attachment_url = NULL WHERE id = ?", m.id);
  emitToConversation(m.conversation_id, 'message:updated', messageDTO(q.get('SELECT * FROM messages WHERE id = ?', m.id), uid));
  return { ok: true };
}));

messages.post('/messages/:id/react', h((req) => {
  const uid = me(req).id;
  const m = q.get('SELECT * FROM messages WHERE id = ? AND deleted = 0', req.params.id);
  if (!m) throw notFound();
  member(m.conversation_id, uid);
  const { emoji } = body(z.object({ emoji: z.string().min(1).max(40) }), req);
  const had = q.get('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, uid, emoji);
  if (had) q.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, uid, emoji);
  else q.run('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?)', m.id, uid, emoji);
  emitToConversation(m.conversation_id, 'message:updated', messageDTO(m, uid));
  return { ok: true };
}));

messages.post('/conversations/:id/read', h((req) => {
  const uid = me(req).id;
  member(req.params.id, uid);
  const ts = now();
  q.run('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', ts, req.params.id, uid);
  if (getPrefs(uid).privacy.readReceipts) emitToConversation(req.params.id, 'read', { conversationId: req.params.id, userId: uid, at: ts });
  return { ok: true };
}));

messages.get('/search', h((req) => {
  const uid = me(req).id;
  const { q: s, conversationId } = query(z.object({ q: z.string().min(2).max(100), conversationId: z.string().optional() }), req);
  const rows = q.all(`SELECT msg.*, u.display_name FROM messages msg JOIN conversation_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ?
                       JOIN users u ON u.id = msg.user_id WHERE msg.deleted = 0 AND msg.body LIKE ? AND (? IS NULL OR msg.conversation_id = ?)
                       ORDER BY msg.created_at DESC LIMIT 50`, uid, `%${s.replace(/[%_]/g, '\\$&')}%`, conversationId ?? null, conversationId ?? null);
  return rows.map((m) => ({ ...messageDTO(m, uid), author: m.display_name }));
}));

// ---------- Custom emoji ----------
export const emoji = Router();
emoji.get('/', h(() => q.all('SELECT name, url FROM custom_emoji ORDER BY name')));
emoji.post('/', requireAuth, requireMod, h((req) => {
  const b = body(z.object({ name: z.string().regex(/^[a-z0-9_]{2,32}$/), url: z.string().startsWith('/uploads/') }), req);
  q.run('INSERT INTO custom_emoji (id, name, url, created_by) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET url = excluded.url', id(), b.name, b.url, me(req).id);
  return { ok: true };
}));
emoji.delete('/:name', requireAuth, requireMod, h((req) => {
  q.run('DELETE FROM custom_emoji WHERE name = ?', req.params.name);
  return { ok: true };
}));
