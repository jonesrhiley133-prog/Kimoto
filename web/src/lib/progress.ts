import { api } from './api';

/** Progress writes are queued locally when offline and flushed when the connection returns. */
const KEY = 'kimoto-progress-queue';
type Item = { chapterId: string; titleId: string; page: number; totalPages: number; scroll: number; completed: boolean; sessionId?: string | null };

const load = (): Record<string, Item> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const store = (q: Record<string, Item>) => localStorage.setItem(KEY, JSON.stringify(q));

export async function saveProgress(item: Item): Promise<{ counted?: boolean; next?: any } | null> {
  try {
    const r = await api.post('/reading/progress', item);
    const q = load();
    if (q[item.chapterId]) { delete q[item.chapterId]; store(q); }
    return r;
  } catch {
    const q = load();
    const prev = q[item.chapterId];
    q[item.chapterId] = { ...item, completed: item.completed || !!prev?.completed };
    store(q);
    return null;
  }
}

export async function flushProgress() {
  const q = load();
  for (const item of Object.values(q)) {
    try {
      await api.post('/reading/progress', { ...item, sessionId: null });
      delete q[item.chapterId];
    } catch { break; }
  }
  store(q);
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushProgress());
  setTimeout(() => navigator.onLine && flushProgress(), 3000);
}
