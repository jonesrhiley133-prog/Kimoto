/**
 * Discord Rich Presence bridge.
 *
 * Browsers cannot talk to Discord's local IPC socket, so Kimoto ships a small desktop companion
 * (companion/) that listens on ws://127.0.0.1:47123 and forwards presence to Discord. This module
 * connects to it only while presence is enabled, and applies the user's privacy choices.
 */
export interface DiscordPrefs { enabled: boolean; hideTitle: boolean; hideChapter: boolean; hideDuration: boolean }
export interface PresenceInput { title: string; chapter: string; type: string; startedAt: number; coverUrl?: string | null; page?: string }

const PORT = 47123;
let ws: WebSocket | null = null;
let status: 'off' | 'connecting' | 'connected' | 'unavailable' = 'off';
let pending: object | null = null;
const listeners = new Set<(s: typeof status) => void>();
const setStatus = (s: typeof status) => { status = s; listeners.forEach((f) => f(s)); };
export const onDiscordStatus = (f: (s: typeof status) => void) => { listeners.add(f); f(status); return () => { listeners.delete(f); }; };

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setStatus('connecting');
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  } catch {
    setStatus('unavailable');
    return;
  }
  ws.onopen = () => { setStatus('connected'); if (pending) ws!.send(JSON.stringify(pending)); };
  ws.onclose = () => { setStatus('unavailable'); ws = null; };
  ws.onerror = () => setStatus('unavailable');
}

export function setPresence(p: PresenceInput | null, prefs: DiscordPrefs | undefined) {
  if (!prefs?.enabled) {
    if (ws) { ws.send(JSON.stringify({ type: 'clear' })); ws.close(); ws = null; }
    setStatus('off');
    return;
  }
  const payload = p
    ? {
        type: 'presence',
        details: prefs.hideTitle ? `Reading ${p.type === 'novel' ? 'a light novel' : 'manga'}` : `Reading ${p.title}`.slice(0, 128),
        state: prefs.hideChapter ? 'On Kimoto' : p.chapter.slice(0, 128),
        startTimestamp: prefs.hideDuration ? undefined : Math.floor(p.startedAt / 1000),
        largeImageText: prefs.hideTitle ? 'Kimoto' : p.title.slice(0, 128),
      }
    : { type: 'clear' };
  pending = payload;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  else connect();
}

export function testCompanion(): Promise<boolean> {
  return new Promise((resolve) => {
    let s: WebSocket;
    try { s = new WebSocket(`ws://127.0.0.1:${PORT}`); } catch { return resolve(false); }
    const t = setTimeout(() => { s.close(); resolve(false); }, 1500);
    s.onopen = () => { clearTimeout(t); s.send(JSON.stringify({ type: 'ping' })); s.close(); resolve(true); };
    s.onerror = () => { clearTimeout(t); resolve(false); };
  });
}
