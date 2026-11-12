/**
 * Offline storage + download manager.
 *
 * Chapter pages are stored as Blobs in IndexedDB (`pages`), with a record per chapter (`chapters`).
 * The queue is persisted, so downloads survive reloads and resume where they left off. Only chapters
 * whose source marks them `downloadable` are accepted.
 */
import { api, enc } from './api';
import type { Chapter, PageData, Title } from './types';

export type DLStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error';
export interface DLRecord {
  chapterId: string; titleId: string; titleName: string; coverUrl: string | null; label: string; type: string;
  status: DLStatus; kind: 'images' | 'text'; total: number; done: number; bytes: number; html?: string;
  error?: string; createdAt: number; finishedAt?: number; readAt?: number; quality: 'data' | 'saver';
}

const DB = 'kimoto-offline';
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('chapters', { keyPath: 'chapterId' });
      d.createObjectStore('pages');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function store(name: 'chapters' | 'pages', mode: IDBTransactionMode = 'readonly') {
  return (await db()).transaction(name, mode).objectStore(name);
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function allDownloads(): Promise<DLRecord[]> {
  return req((await store('chapters')).getAll() as IDBRequest<DLRecord[]>);
}
export async function getDownload(chapterId: string): Promise<DLRecord | undefined> {
  return req((await store('chapters')).get(chapterId) as IDBRequest<DLRecord | undefined>);
}
async function put(rec: DLRecord) {
  await req((await store('chapters', 'readwrite')).put(rec));
  emit();
}
export async function pageBlob(chapterId: string, i: number): Promise<Blob | undefined> {
  return req((await store('pages')).get(`${chapterId}#${i}`) as IDBRequest<Blob | undefined>);
}

/** Offline copy of a chapter in the same shape the reader uses, or null. */
export async function offlinePages(chapterId: string): Promise<(PageData & { revoke?: () => void }) | null> {
  const rec = await getDownload(chapterId);
  if (!rec || rec.status !== 'done') return null;
  if (rec.kind === 'text') return { kind: 'text', html: rec.html ?? '' };
  const urls: string[] = [];
  for (let i = 0; i < rec.total; i++) {
    const b = await pageBlob(chapterId, i);
    if (b) urls.push(URL.createObjectURL(b));
  }
  return { kind: 'images', pages: urls.map((url) => ({ url })), revoke: () => urls.forEach(URL.revokeObjectURL) };
}

export async function deleteDownload(chapterId: string) {
  const rec = await getDownload(chapterId);
  const pages = await store('pages', 'readwrite');
  for (let i = 0; i < (rec?.total ?? 0); i++) pages.delete(`${chapterId}#${i}`);
  await req((await store('chapters', 'readwrite')).delete(chapterId));
  if (active?.chapterId === chapterId) abort?.abort();
  emit();
  syncRecords([chapterId], true);
}
export async function markRead(chapterId: string) {
  const rec = await getDownload(chapterId);
  if (rec) await put({ ...rec, readAt: Date.now() });
}

// ---------- Queue ----------
type Listener = () => void;
const listeners = new Set<Listener>();
export const subscribe = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((f) => f());

let running = false;
let active: DLRecord | null = null;
let abort: AbortController | null = null;
let globalPaused = localStorage.getItem('kimoto-dl-paused') === '1';
export const isPaused = () => globalPaused;

export async function enqueue(title: Title, chapters: Chapter[], quality: 'data' | 'saver' = 'data') {
  let added = 0;
  for (const c of chapters) {
    if (!c.downloadable || c.externalUrl) continue;
    const existing = await getDownload(c.id);
    if (existing && existing.status !== 'error') continue;
    await put({
      chapterId: c.id, titleId: title.id, titleName: title.title, coverUrl: title.coverUrl, type: title.type,
      label: `${c.volume ? `Vol. ${c.volume} ` : ''}Ch. ${c.numberLabel ?? c.number ?? '?'}${c.name ? ` — ${c.name}` : ''}`,
      status: 'queued', kind: 'images', total: c.pages ?? 0, done: 0, bytes: 0, createdAt: Date.now() + added, quality,
    });
    added++;
  }
  pump();
  return added;
}

export function pauseAll() { globalPaused = true; localStorage.setItem('kimoto-dl-paused', '1'); abort?.abort(); emit(); }
export function resumeAll() { globalPaused = false; localStorage.setItem('kimoto-dl-paused', '0'); emit(); pump(); }
export async function pauseOne(chapterId: string) {
  const r = await getDownload(chapterId);
  if (r && r.status !== 'done') await put({ ...r, status: 'paused' });
  if (active?.chapterId === chapterId) abort?.abort();
}
export async function resumeOne(chapterId: string) {
  const r = await getDownload(chapterId);
  if (r && (r.status === 'paused' || r.status === 'error')) await put({ ...r, status: 'queued', error: undefined });
  pump();
}

async function fetchBlob(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function downloadOne(rec: DLRecord) {
  abort = new AbortController();
  const signal = abort.signal;
  const pages = await api.get<PageData>(`/chapters/${enc(rec.chapterId)}/pages${rec.quality === 'saver' ? '?saver=1' : ''}`);
  if (pages.kind === 'external') throw new Error('This chapter is hosted externally and cannot be downloaded.');
  if (pages.kind === 'text') {
    await put({ ...rec, kind: 'text', html: pages.html, total: 1, done: 1, bytes: pages.html.length * 2, status: 'done', finishedAt: Date.now() });
    return;
  }
  rec = { ...rec, kind: 'images', total: pages.pages.length };
  await put(rec);
  // Skip pages already stored (resume), fetch the rest 3 at a time.
  let i = 0;
  const worker = async () => {
    while (i < pages.pages.length) {
      const n = i++;
      if (await pageBlob(rec.chapterId, n)) continue;
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      let blob: Blob;
      try { blob = await fetchBlob(pages.pages[n].url, signal); } catch (e) {
        if (!pages.pages[n].fallbackUrl || signal.aborted) throw e;
        blob = await fetchBlob(pages.pages[n].fallbackUrl!, signal);
      }
      await req((await store('pages', 'readwrite')).put(blob, `${rec.chapterId}#${n}`));
      rec = { ...rec, done: rec.done + 1, bytes: rec.bytes + blob.size };
      await put(rec);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  let done = 0;
  for (let k = 0; k < rec.total; k++) if (await pageBlob(rec.chapterId, k)) done++;
  await put({ ...rec, done, status: done === rec.total ? 'done' : 'error', error: done === rec.total ? undefined : 'Some pages failed', finishedAt: Date.now() });
}

export async function pump() {
  if (running || globalPaused) return;
  running = true;
  try {
    while (!globalPaused) {
      const next = (await allDownloads()).filter((r) => r.status === 'queued' || r.status === 'downloading').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) break;
      active = { ...next, status: 'downloading' };
      await put(active);
      try {
        await downloadOne(active);
      } catch (e: any) {
        const cur = await getDownload(active.chapterId);
        if (cur) {
          if (e?.name === 'AbortError') await put({ ...cur, status: globalPaused || cur.status === 'paused' ? 'paused' : 'queued' });
          else await put({ ...cur, status: 'error', error: e?.message ?? 'Download failed' });
        }
        if (e?.name !== 'AbortError' && !navigator.onLine) break;
      }
      syncRecords([active.chapterId]);
      active = null;
    }
  } finally {
    running = false;
    active = null;
    await enforceStorage();
  }
}

// ---------- Storage management ----------
export interface DownloadSettings { quality: 'data' | 'saver'; autoDeleteRead: boolean; autoDeleteDays: number; maxStorageMB: number; wifiOnly: boolean }
export const DEFAULT_DL: DownloadSettings = { quality: 'data', autoDeleteRead: false, autoDeleteDays: 7, maxStorageMB: 2048, wifiOnly: false };
let settings: DownloadSettings = DEFAULT_DL;
export const setDownloadSettings = (s: Partial<DownloadSettings> | undefined) => { settings = { ...DEFAULT_DL, ...(s ?? {}) }; };

export async function enforceStorage() {
  const all = await allDownloads();
  const now = Date.now();
  // Auto-delete chapters read more than N days ago.
  if (settings.autoDeleteRead) {
    for (const r of all) if (r.readAt && now - r.readAt > settings.autoDeleteDays * 86400_000) await deleteDownload(r.chapterId);
  }
  // Enforce the storage cap by evicting read chapters first, then oldest.
  let total = (await allDownloads()).reduce((n, r) => n + r.bytes, 0);
  const cap = settings.maxStorageMB * 1048576;
  if (total <= cap) return;
  const victims = (await allDownloads()).filter((r) => r.status === 'done').sort((a, b) => (a.readAt ? 0 : 1) - (b.readAt ? 0 : 1) || a.createdAt - b.createdAt);
  for (const v of victims) {
    if (total <= cap) break;
    await deleteDownload(v.chapterId);
    total -= v.bytes;
  }
}

export async function storageEstimate() {
  const used = (await allDownloads()).reduce((n, r) => n + r.bytes, 0);
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  return { used, quota: est?.quota ?? null, browserUsage: est?.usage ?? null };
}

// ---------- Cross-device records ----------
export const deviceId = () => {
  let d = localStorage.getItem('kimoto-device');
  if (!d) { d = crypto.randomUUID(); localStorage.setItem('kimoto-device', d); }
  return d;
};
async function syncRecords(chapterIds: string[], removed = false) {
  try {
    if (removed) return void (await api.del('/settings/downloads', { deviceId: deviceId(), chapterIds }));
    const items = (await Promise.all(chapterIds.map(getDownload))).filter(Boolean).map((r) => ({ chapterId: r!.chapterId, titleId: r!.titleId, status: r!.status === 'downloading' ? 'downloading' : r!.status, bytes: r!.bytes }));
    if (items.length) await api.put('/settings/downloads', { deviceId: deviceId(), items });
  } catch { /* offline: records sync next time */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => pump());
  setTimeout(() => pump(), 2000);
}
