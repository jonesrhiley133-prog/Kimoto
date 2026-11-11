import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { userForToken, COOKIE } from './lib/auth.js';
import { q, now } from './db/index.js';
import { getPrefs } from './services/prefs.js';
import { take } from './lib/rateLimit.js';

let io: Server | null = null;
const online = new Map<string, number>(); // userId -> open socket count

export const isOnline = (userId: string) => (online.get(userId) ?? 0) > 0;
export const emitToUser = (userId: string, event: string, payload: unknown) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToConversation = (conversationId: string, event: string, payload: unknown) => io?.to(`conv:${conversationId}`).emit(event, payload);

function parseCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Friends (accepted) — they receive presence updates. */
function friendIds(userId: string): string[] {
  return q.all<{ id: string }>(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id FROM friendships
      WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`, userId, userId, userId).map((r) => r.id);
}

function broadcastPresence(userId: string, isOn: boolean) {
  if (!getPrefs(userId).privacy.showOnline) return;
  for (const f of friendIds(userId)) emitToUser(f, 'presence', { userId, online: isOn, at: now() });
}

export function attachRealtime(server: HttpServer, corsOrigin: string) {
  io = new Server(server, { path: '/socket.io', cors: { origin: corsOrigin, credentials: true }, maxHttpBufferSize: 1e5 });

  io.use((socket, next) => {
    const user = userForToken(parseCookie(socket.handshake.headers.cookie, COOKIE));
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string };
    socket.join(`user:${user.id}`);
    const convs = q.all<{ conversation_id: string }>('SELECT conversation_id FROM conversation_members WHERE user_id = ?', user.id);
    convs.forEach((c) => socket.join(`conv:${c.conversation_id}`));
    const n = (online.get(user.id) ?? 0) + 1;
    online.set(user.id, n);
    if (n === 1) broadcastPresence(user.id, true);

    socket.on('conv:join', (conversationId: string) => {
      if (q.get('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conversationId, user.id)) socket.join(`conv:${conversationId}`);
    });
    socket.on('typing', (p: { conversationId: string; typing: boolean }) => {
      if (!p?.conversationId || !take(`typing:${user.id}`, 20, 60)) return;
      if (!socket.rooms.has(`conv:${p.conversationId}`)) return;
      if (!getPrefs(user.id).privacy.typingIndicators) return;
      socket.to(`conv:${p.conversationId}`).emit('typing', { conversationId: p.conversationId, userId: user.id, username: user.username, typing: !!p.typing });
    });

    socket.on('disconnect', () => {
      const left = (online.get(user.id) ?? 1) - 1;
      if (left <= 0) {
        online.delete(user.id);
        q.run('UPDATE profiles SET last_seen_at = ? WHERE user_id = ?', now(), user.id);
        broadcastPresence(user.id, false);
      } else online.set(user.id, left);
    });
  });
  return io;
}

/** Called when a user joins a new conversation so their open sockets get the room. */
export function joinConversationRoom(userId: string, conversationId: string) {
  io?.in(`user:${userId}`).socketsJoin(`conv:${conversationId}`);
}
export function leaveConversationRoom(userId: string, conversationId: string) {
  io?.in(`user:${userId}`).socketsLeave(`conv:${conversationId}`);
}
