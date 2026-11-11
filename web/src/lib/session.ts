import { api, enc } from './api';

/**
 * Measures *active* reading time: the tab must be visible and the reader must have interacted
 * (scroll, key, tap, page turn) within the idle window. Heartbeats every 30s; the final beat is
 * sent with sendBeacon so closing the tab still records it.
 */
const IDLE_MS = 120_000;
const BEAT_MS = 30_000;

export class ReadingSession {
  id: string | null = null;
  private active = 0; // seconds since last beat
  private pages = 0;
  private lastInteraction = Date.now();
  private lastTick = Date.now();
  private chapterId: string | undefined;
  private timer: number | undefined;
  private beatTimer: number | undefined;
  private stopped = false;

  constructor(private titleId: string, chapterId: string, private enabled: boolean) {
    this.chapterId = chapterId;
  }

  async start() {
    if (!this.enabled) return;
    try {
      const r = await api.post<{ id: string | null }>('/reading/sessions/start', { titleId: this.titleId, chapterId: this.chapterId, device: /Mobi/i.test(navigator.userAgent) ? 'mobile' : 'desktop' });
      this.id = r.id;
    } catch { return; }
    if (!this.id || this.stopped) return;
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, this.touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('pagehide', this.onHide);
    this.timer = window.setInterval(this.tick, 1000);
    this.beatTimer = window.setInterval(() => this.beat(), BEAT_MS);
  }

  private touch = () => { this.lastInteraction = Date.now(); };
  private tick = () => {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (document.visibilityState === 'visible' && now - this.lastInteraction < IDLE_MS && dt < 5) this.active += dt;
  };
  private onVis = () => { if (document.visibilityState === 'hidden') this.beat(); else this.lastTick = Date.now(); };
  private onHide = () => this.end();

  pageTurned() { this.pages++; this.touch(); }
  setChapter(chapterId: string) {
    if (chapterId === this.chapterId) return;
    this.beat(chapterId);
    this.chapterId = chapterId;
  }

  private payload(chapterId?: string) {
    const p = { activeSeconds: Math.round(this.active), pagesRead: this.pages, chapterId: chapterId ?? this.chapterId };
    this.active = 0;
    this.pages = 0;
    return p;
  }
  beat(chapterId?: string) {
    if (!this.id) return;
    api.post(`/reading/sessions/${enc(this.id)}/beat`, this.payload(chapterId)).catch(() => undefined);
  }
  end() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.beatTimer);
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((e) => window.removeEventListener(e, this.touch, { capture: true }));
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('pagehide', this.onHide);
    if (!this.id) return;
    this.tick();
    const body = JSON.stringify(this.payload());
    const url = `/api/reading/sessions/${enc(this.id)}/end`;
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) {
      fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain', 'x-kimoto': '1' }, keepalive: true }).catch(() => undefined);
    }
  }
}
