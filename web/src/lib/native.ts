/**
 * Native (Capacitor) integration. Everything here is a no-op in the browser.
 *
 * In the Android app the web bundle runs from a local origin, so:
 *  - the API lives on a user-chosen Kimoto server (`serverUrl()`),
 *  - auth uses a bearer token instead of the session cookie,
 *  - server-relative URLs ("/api/…", "/uploads/…") are made absolute.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'

const SERVER_KEY = 'kimoto-server';
const TOKEN_KEY = 'kimoto-token';

export function serverUrl(): string {
  if (!isNative) return '';
  return (localStorage.getItem(SERVER_KEY) ?? import.meta.env.VITE_DEFAULT_SERVER ?? '').replace(/\/$/, '');
}
export function setServerUrl(url: string | null) {
  if (url) localStorage.setItem(SERVER_KEY, url.replace(/\/$/, ''));
  else localStorage.removeItem(SERVER_KEY);
}
export const getToken = () => (isNative ? localStorage.getItem(TOKEN_KEY) : null);
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Makes a server-relative URL absolute in the app (unchanged on the web). */
export function abs<T extends string | null | undefined>(url: T): T {
  if (!isNative || !url || url[0] !== '/' || url[1] === '/') return url;
  return (serverUrl() + url) as T;
}

/** Rewrites server-relative media/API URLs inside an API response. */
export function absolutize<T>(data: T): T {
  if (!isNative) return data;
  const walk = (v: any): any => {
    if (typeof v === 'string') return v.startsWith('/api/') || v.startsWith('/uploads/') ? serverUrl() + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const k in v) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(data);
}

/** Checks that a URL points at a Kimoto server. Returns the normalized URL or throws. */
export async function checkServer(input: string): Promise<string> {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let res: Response;
  try {
    res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error("Couldn't reach that address. Check the URL, and that your phone can reach the server.");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error("That address responded, but it doesn't look like a Kimoto server.");
  return url;
}

// ---------------- Plugins (loaded lazily so the web bundle stays light) ----------------

/** Hardware back button, status bar, splash screen and resume handling. */
export async function initNative(opts: { navigateBack: () => void; onResume: () => void }) {
  if (!isNative) return;
  const [{ App }, { SplashScreen }, { StatusBar }] = await Promise.all([import('@capacitor/app'), import('@capacitor/splash-screen'), import('@capacitor/status-bar')]);
  App.addListener('backButton', ({ canGoBack }) => (canGoBack ? opts.navigateBack() : App.exitApp())).catch(() => undefined);
  App.addListener('appStateChange', ({ isActive }) => isActive && opts.onResume()).catch(() => undefined);
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
  document.documentElement.classList.add('native', `native-${platform}`);
  setTimeout(() => SplashScreen.hide().catch(() => undefined), 150);
}

/** Matches the system status bar to the current theme. */
export async function setStatusBar(bg: string, dark: boolean) {
  if (!isNative) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  StatusBar.setBackgroundColor({ color: bg }).catch(() => undefined);
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
}

/** Immersive reading: hide the status bar. */
export async function setStatusBarHidden(hidden: boolean) {
  if (!isNative) return;
  const { StatusBar } = await import('@capacitor/status-bar');
  (hidden ? StatusBar.hide() : StatusBar.show()).catch(() => undefined);
}

/** Keep the screen on while reading. */
export async function keepAwake(on: boolean) {
  if (!isNative) return;
  const { KeepAwake } = await import('@capacitor-community/keep-awake');
  (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => undefined);
}

/**
 * Volume-button page turning (custom Android plugin, see android/…/VolumeKeysPlugin.java).
 * While enabled, the hardware buttons turn pages instead of changing the volume; the plugin
 * fires the same "AudioVolumeUp/Down" key events the reader already handles.
 */
interface VolumeKeysPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
  addListener(event: 'volume', fn: (e: { direction: 'up' | 'down' }) => void): Promise<PluginListenerHandle>;
}
const VolumeKeys = registerPlugin<VolumeKeysPlugin>('VolumeKeys');
export async function volumeKeys(on: boolean): Promise<() => void> {
  if (platform !== 'android') return () => undefined;
  try {
    if (!on) { await VolumeKeys.disable(); return () => undefined; }
    await VolumeKeys.enable();
    const h = await VolumeKeys.addListener('volume', ({ direction }) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: direction === 'down' ? 'AudioVolumeDown' : 'AudioVolumeUp' }));
    });
    return () => { h.remove(); VolumeKeys.disable().catch(() => undefined); };
  } catch {
    return () => undefined;
  }
}

/** Show a system notification (used for real-time events while the app is in the background). */
let notifPermission: boolean | null = null;
export async function localNotify(n: { id: string; title: string; body?: string; link?: string | null }) {
  if (!isNative) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (notifPermission === null) notifPermission = (await LocalNotifications.requestPermissions()).display === 'granted';
  if (!notifPermission) return;
  let hash = 0;
  for (const c of n.id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  await LocalNotifications.schedule({ notifications: [{ id: Math.abs(hash), title: n.title, body: n.body ?? '', extra: { link: n.link } }] }).catch(() => undefined);
}
export async function onNotificationTap(go: (link: string) => void) {
  if (!isNative) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  LocalNotifications.addListener('localNotificationActionPerformed', (a) => a.notification.extra?.link && go(a.notification.extra.link)).catch(() => undefined);
}
export async function requestNotificationPermission() {
  if (!isNative) return false;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  notifPermission = (await LocalNotifications.requestPermissions()).display === 'granted';
  return notifPermission;
}

/** Open a URL outside the app (OAuth, publisher sites). */
export async function openExternal(url: string) {
  if (!isNative) return void window.open(url, '_blank', 'noopener');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

/** Download an authenticated API file: an <a download> on the web, save + share sheet in the app. */
export async function downloadFile(path: string, filename: string) {
  if (!isNative) {
    const a = document.createElement('a');
    a.href = `/api${path}`;
    a.download = filename;
    a.click();
    return;
  }
  const res = await fetch(`${serverUrl()}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}`, 'x-kimoto': '1' } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const text = await res.text();
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const saved = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: filename, url: saved.uri, dialogTitle: 'Save or share' });
}
