import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Notification, SessionUser } from '@/lib/types';
import { applyTheme, resolveTheme, type ThemeData } from '@/lib/theme';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { setDownloadSettings } from '@/lib/offline';
import { isNative, localNotify, serverUrl, setStatusBar, setToken } from '@/lib/native';

// ---------------- Toasts ----------------
type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success'; action?: { label: string; onClick: () => void } };
const ToastCtx = createContext<(text: string, kind?: Toast['kind'], action?: Toast['action']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[100] bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none w-[min(92vw,420px)]" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto panel shadow-card px-4 py-2.5 text-sm flex items-center gap-3 w-full ${t.kind === 'error' ? 'border-danger/60' : t.kind === 'success' ? 'border-success/60' : ''}`}>
            <span className="flex-1">{t.text}</span>
            {t.action && <button className="text-primary font-medium" onClick={t.action.onClick}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------- Auth + prefs ----------------
interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  prefs: any;
  setPrefs: (patch: Record<string, any>) => void;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  themes: { id: string; name: string; data: ThemeData }[];
  reloadThemes: () => void;
  unread: { notifications: number; messages: number };
  previewTheme: (t: ThemeData | null) => void;
}
const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

const LOCAL_PREFS = 'kimoto-prefs-cache';
const USER_CACHE = 'kimoto-user-cache';
function deepMerge(a: any, b: any): any {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  return out;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [prefs, setPrefsState] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_PREFS) ?? '{}'); } catch { return {}; }
  });
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<ThemeData | null>(null);
  const [unread, setUnread] = useState({ notifications: 0, messages: 0 });
  const pendingPatch = useRef<Record<string, any>>({});
  const flushTimer = useRef<number>();

  const setUser = useCallback((u: SessionUser | null) => {
    setUserState(u);
    // Remember who's signed in so the app can open (and read downloads) without a connection.
    if (u) localStorage.setItem(USER_CACHE, JSON.stringify(u));
    else localStorage.removeItem(USER_CACHE);
    if (u?.prefs) {
      setPrefsState(u.prefs);
      localStorage.setItem(LOCAL_PREFS, JSON.stringify(u.prefs));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (isNative && !serverUrl()) return setLoading(false); // app not connected to a server yet
    try {
      const r = await api.get<{ user: SessionUser | null }>('/auth/me');
      setUser(r.user);
    } catch {
      // Offline: fall back to the last signed-in user and cached prefs so offline reading still works.
      try {
        const cached = localStorage.getItem(USER_CACHE);
        if (cached) setUserState(JSON.parse(cached));
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }, [setUser]);
  useEffect(() => { refresh(); }, [refresh]);

  const setPrefs = useCallback((patch: Record<string, any>) => {
    setPrefsState((p: any) => {
      const next = deepMerge(p, patch);
      localStorage.setItem(LOCAL_PREFS, JSON.stringify(next));
      return next;
    });
    pendingPatch.current = deepMerge(pendingPatch.current, patch);
    clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const body = pendingPatch.current;
      pendingPatch.current = {};
      api.patch('/settings/prefs', body).catch(() => undefined);
    }, 500);
  }, []);

  const themesQ = useQuery({
    queryKey: ['themes'], enabled: !!user,
    queryFn: () => api.get<{ id: string; name: string; data: ThemeData }[]>('/settings/themes'),
  });
  const themes = themesQ.data ?? [];

  // Apply theme whenever preferences or saved themes change (or a live preview is active).
  useEffect(() => {
    const t = preview ?? resolveTheme(prefs.appearance, themes);
    applyTheme(t);
    setStatusBar(t.colors.bg, t.dark);
  }, [prefs.appearance, themes, preview]);
  useEffect(() => setDownloadSettings(prefs.downloads), [prefs.downloads]);

  // Realtime: notifications + unread counters.
  useEffect(() => {
    if (!user) { disconnectSocket(); return; }
    const s = connectSocket();
    const loadCounts = async () => {
      try {
        const [n, m] = await Promise.all([api.get('/notifications?limit=1&unread=1'), api.get('/messages/unread')]);
        setUnread({ notifications: n.unread, messages: m.c });
      } catch { /* offline */ }
    };
    loadCounts();
    const onNotification = (n: Notification) => {
      setUnread((u) => ({ ...u, notifications: u.notifications + 1, messages: n.kind === 'message' ? u.messages + 1 : u.messages }));
      qc.invalidateQueries({ queryKey: ['notifications'] });
      const p = (prefsRef.current?.notifications ?? {}) as any;
      const viewingThread = n.kind === 'message' && location.pathname === `/messages/${n.data?.conversationId}`;
      if (p.browser !== false && document.visibilityState === 'hidden' && !viewingThread && 'Notification' in window && Notification.permission === 'granted') {
        const note = new Notification(n.title, { body: n.body, icon: n.imageUrl ?? '/icon.svg', tag: n.id });
        note.onclick = () => { window.focus(); if (n.link) location.assign(n.link); };
      }
      // In the Android app, show a system notification while the app is in the background.
      if (isNative && p.browser !== false && document.visibilityState === 'hidden' && !viewingThread) localNotify({ id: n.id, title: n.title, body: n.body, link: n.link });
    };
    s.on('notification', onNotification);
    s.on('connect', loadCounts);
    const onFocus = () => loadCounts();
    window.addEventListener('focus', onFocus);
    return () => { s.off('notification', onNotification); s.off('connect', loadCounts); window.removeEventListener('focus', onFocus); };
  }, [user, qc]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Keep counters fresh when lists are read elsewhere in the app.
  useEffect(() => {
    const h = (e: Event) => setUnread((u) => ({ ...u, ...(e as CustomEvent).detail }));
    window.addEventListener('kimoto:unread', h);
    return () => window.removeEventListener('kimoto:unread', h);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setToken(null);
    localStorage.removeItem(USER_CACHE);
    setUserState(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(() => ({
    user, loading, prefs, setPrefs, setUser, logout, refresh, themes, reloadThemes: () => themesQ.refetch(), unread, previewTheme: setPreview,
  }), [user, loading, prefs, setPrefs, setUser, logout, refresh, themes, themesQ, unread]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const setUnreadCounts = (detail: Partial<{ notifications: number; messages: number }>) => window.dispatchEvent(new CustomEvent('kimoto:unread', { detail }));
