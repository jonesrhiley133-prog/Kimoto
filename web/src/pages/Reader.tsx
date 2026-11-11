import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Expand, List, MessageSquare, NotebookPen, Pause, Play,
  Quote, Settings2, Shrink, Trash2, X, WifiOff, ExternalLink, RotateCcw,
} from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { chapterLabel, cls, TYPE_LABEL } from '@/lib/format';
import { novelProfile, readerProfile, NOVEL_THEMES, type NovelProfile, type ReaderProfile } from '@/lib/prefs';
import type { Chapter, PageData, Title } from '@/lib/types';
import { allDownloads, getDownload, markRead, offlinePages } from '@/lib/offline';
import { ReadingSession } from '@/lib/session';
import { saveProgress } from '@/lib/progress';
import { setPresence } from '@/lib/discord';
import { ErrorState, PageLoader, Range, Segmented, Select, Spinner, Toggle } from '@/components/ui';
import { Comments } from '@/components/comments';

interface Loaded {
  chapter: Chapter;
  title: Pick<Title, 'id' | 'title' | 'type' | 'coverUrl'> & Partial<Title>;
  chapters: Chapter[];
  pages: PageData & { revoke?: () => void };
  resume: { page: number; scroll: number; completed: boolean } | null;
  offline: boolean;
}

/** Data-saver preference for the title's type, read from the cached prefs (loader runs outside React). */
function wantsSaver(type?: string) {
  try {
    const p = JSON.parse(localStorage.getItem('kimoto-prefs-cache') ?? '{}');
    const key = !type || type === 'novel' ? 'manga' : type;
    return !!p.reader?.profiles?.[key]?.dataSaver;
  } catch { return false; }
}

const titleIdFromChapter = (cid: string) => (cid.startsWith('local:') ? `local:${cid.slice(6).split('/')[0]}` : null);

async function loadChapter(chapterId: string): Promise<Loaded> {
  const dl = await getDownload(chapterId);
  try {
    let chapter: Chapter;
    try {
      chapter = await api.get<Chapter>(`/chapters/${enc(chapterId)}`);
    } catch (e: any) {
      const tid = titleIdFromChapter(chapterId) ?? dl?.titleId;
      if (e.status !== 404 || !tid) throw e;
      await api.get(`/titles/${enc(tid)}/chapters`); // populate the cache, then retry
      chapter = await api.get<Chapter>(`/chapters/${enc(chapterId)}`);
    }
    const [titleResp, chResp, resume] = await Promise.all([
      api.get<{ title: Title }>(`/titles/${enc(chapter.titleId)}`),
      api.get<{ chapters: Chapter[] }>(`/titles/${enc(chapter.titleId)}/chapters`),
      api.get<Loaded['resume']>(`/reading/progress/${enc(chapterId)}`).catch(() => null),
    ]);
    const off = dl?.status === 'done' ? await offlinePages(chapterId) : null;
    const pages = off ?? (chapter.externalUrl ? { kind: 'external' as const, url: chapter.externalUrl } : await api.get<PageData>(`/chapters/${enc(chapterId)}/pages${wantsSaver(titleResp.title.type) ? '?saver=1' : ''}`));
    return { chapter, title: titleResp.title, chapters: chResp.chapters, pages, resume, offline: !!off };
  } catch (e) {
    // Fully offline: read from the download store.
    const off = dl?.status === 'done' ? await offlinePages(chapterId) : null;
    if (!dl || !off) throw e;
    const siblings = (await allDownloads()).filter((d) => d.titleId === dl.titleId && d.status === 'done');
    const num = (label: string) => Number(label.match(/Ch\. ([\d.]+)/)?.[1] ?? 0);
    const asChapter = (d: typeof dl): Chapter => ({ id: d.chapterId, titleId: d.titleId, number: num(d.label), numberLabel: String(num(d.label)), volume: null, name: d.label.split(' — ')[1] ?? null, language: null, group: null, pages: d.total, publishedAt: null, externalUrl: null, downloadable: true });
    return {
      chapter: asChapter(dl), title: { id: dl.titleId, title: dl.titleName, type: dl.type as Title['type'], coverUrl: dl.coverUrl },
      chapters: siblings.map(asChapter).sort((a, b) => (b.number ?? 0) - (a.number ?? 0)), pages: off, resume: null, offline: true,
    };
  }
}

export default function Reader() {
  const chapterId = useParams().chapterId!;
  const q = useQuery({ queryKey: ['reader', chapterId], queryFn: () => loadChapter(chapterId), staleTime: Infinity, gcTime: 0, retry: false });
  useEffect(() => () => { if (q.data?.pages && 'revoke' in q.data.pages) q.data.pages.revoke?.(); }, [q.data]);
  if (q.isLoading) return <div className="min-h-screen bg-black"><PageLoader /></div>;
  if (q.error) return <div className="min-h-screen"><div className="p-4"><Link to="/" className="btn-ghost"><ArrowLeft className="h-4 w-4" />Home</Link></div><ErrorState error={q.error} retry={q.refetch} /></div>;
  return <ReaderView key={chapterId} data={q.data!} />;
}

/** Keeps one reading session alive across chapter navigation within the same title. */
let liveSession: { titleId: string; session: ReadingSession; startedAt: number; endTimer?: number } | null = null;

function ReaderView({ data }: { data: Loaded }) {
  const { chapter, title, chapters, pages, offline } = data;
  const { user, prefs, setPrefs } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const isNovel = pages.kind === 'text';
  const typeKey = title.type === 'novel' ? 'novel' : title.type;
  const profile = readerProfile(prefs, title.type);
  const novel = novelProfile(prefs);
  const setProfile = (patch: Partial<ReaderProfile> | Partial<NovelProfile>) => setPrefs({ reader: { profiles: { [isNovel ? 'novel' : typeKey]: patch } } });

  const imgs = pages.kind === 'images' ? pages.pages : [];
  const total = isNovel ? 1 : imgs.length;
  const [page, setPage] = useState(() => Math.min(data.resume && !data.resume.completed ? data.resume.page : 0, Math.max(0, total - 1)));
  const [atEnd, setAtEnd] = useState(false);
  const [ui, setUi] = useState(profile.toolbar !== 'hidden');
  const [panel, setPanel] = useState<null | 'settings' | 'chapters' | 'notes' | 'comments'>(params.get('comments') ? 'comments' : null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [autoScroll, setAutoScroll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();
  const sorted = useMemo(() => [...chapters].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)), [chapters]);
  const idx = sorted.findIndex((c) => c.id === chapter.id);
  const sameLang = (c?: Chapter) => !c || !chapter.language || c.language === chapter.language;
  const prevCh = [...sorted.slice(0, Math.max(0, idx))].reverse().find((c) => sameLang(c) && (c.number ?? 0) < (chapter.number ?? 0)) ?? (idx > 0 ? sorted[idx - 1] : undefined);
  const nextCh = sorted.slice(idx + 1).find((c) => sameLang(c) && (c.number ?? 0) > (chapter.number ?? 0)) ?? sorted[idx + 1];
  const mode = isNovel ? 'novel' : profile.mode;
  const rtl = profile.direction === 'rtl' && (mode === 'paged' || mode === 'double');

  // ---------- session + presence ----------
  const sessionRef = useRef<ReadingSession | null>(null);
  useEffect(() => {
    if (!user) return;
    if (liveSession && liveSession.titleId === title.id) {
      clearTimeout(liveSession.endTimer);
      liveSession.session.setChapter(chapter.id);
    } else {
      liveSession?.session.end();
      const s = new ReadingSession(title.id, chapter.id, prefs.analytics?.enabled !== false && !offline);
      s.start();
      liveSession = { titleId: title.id, session: s, startedAt: Date.now() };
    }
    sessionRef.current = liveSession.session;
    setPresence({ title: title.title, chapter: chapterLabel(chapter, false), type: title.type, startedAt: liveSession.startedAt, coverUrl: title.coverUrl }, prefs.discord);
    return () => {
      // End shortly after leaving, unless the next chapter of the same title opens first.
      if (liveSession) liveSession.endTimer = window.setTimeout(() => { liveSession?.session.end(); liveSession = null; setPresence(null, prefs.discord); }, 1500);
    };
  }, [chapter.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- progress ----------
  const scrollFrac = useRef(data.resume?.scroll ?? 0);
  const completedRef = useRef(false);
  const countedRef = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const persist = useCallback(async (p: number, completed: boolean) => {
    if (!user) return;
    const r = await saveProgress({ chapterId: chapter.id, titleId: title.id, page: p, totalPages: total, scroll: scrollFrac.current, completed, sessionId: sessionRef.current?.id });
    if (r?.counted) countedRef.current = true;
    if (completed) {
      markRead(chapter.id);
      qc.invalidateQueries({ queryKey: ['chapters', title.id] });
      qc.invalidateQueries({ queryKey: ['continue'] });
    }
  }, [user, chapter.id, title.id, total, qc]);
  // If the chapter was finished too quickly to count, try once more on leaving (by then enough time has usually passed).
  useEffect(() => () => {
    if (user && completedRef.current && !countedRef.current) {
      saveProgress({ chapterId: chapter.id, titleId: title.id, page: pageRef.current, totalPages: total, scroll: scrollFrac.current, completed: true, sessionId: sessionRef.current?.id });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveTimer = useRef<number>();
  useEffect(() => {
    const done = atEnd || (!isNovel && total > 0 && page >= total - 1 && (mode === 'paged' || mode === 'double'));
    clearTimeout(saveTimer.current);
    if (done && !completedRef.current) { completedRef.current = true; persist(page, true); return; }
    saveTimer.current = window.setTimeout(() => persist(page, completedRef.current), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [page, atEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- navigation ----------
  const goChapter = useCallback((c?: Chapter) => {
    if (!c) return toast(c === undefined ? 'No more chapters' : '', 'info');
    if (c.externalUrl) return window.open(c.externalUrl, '_blank', 'noopener');
    nav(`/read/${enc(c.id)}`, { replace: true });
  }, [nav, toast]);
  const step = mode === 'double' ? 2 : 1;
  const turn = useCallback((dir: 1 | -1) => {
    sessionRef.current?.pageTurned();
    if (mode === 'paged' || mode === 'double') {
      setPage((p) => {
        const n = p + dir * step;
        if (n >= total) { setAtEnd(true); return p; }
        if (n < 0) { if (prevCh && dir < 0) goChapter(prevCh); return 0; }
        setAtEnd(false);
        return n;
      });
    } else {
      scrollRef.current?.scrollBy({ top: dir * (profile.scrollSpeed || window.innerHeight * 0.8), behavior: 'smooth' });
    }
  }, [mode, step, total, prevCh, goChapter, profile.scrollSpeed]);

  // Auto-advance to the next chapter at the end, if enabled.
  useEffect(() => {
    if (!atEnd) return;
    const auto = isNovel ? novel.autoNext : profile.autoNext && profile.chapterTransition === 'auto';
    if (auto && nextCh) {
      const t = setTimeout(() => goChapter(nextCh), 1500);
      return () => clearTimeout(t);
    }
  }, [atEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- toolbar visibility ----------
  const poke = useCallback(() => {
    if (profile.toolbar === 'always') return setUi(true);
    clearTimeout(hideTimer.current);
    if (profile.toolbar === 'auto') hideTimer.current = window.setTimeout(() => !panel && setUi(false), 3500);
  }, [profile.toolbar, panel]);
  useEffect(() => { if (profile.immersive) setUi(false); else poke(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleUi = () => { setUi((u) => !u); poke(); };

  // ---------- fullscreen ----------
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast('Fullscreen is not available here', 'info'); }
  };
  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // ---------- bookmarks ----------
  const notes = useQuery({ queryKey: ['annotations', chapter.id], enabled: !!user && !offline, queryFn: () => api.get<any[]>(`/reading/annotations?chapterId=${enc(chapter.id)}`) });
  const bookmarked = notes.data?.some((n) => n.kind === 'bookmark' && n.page === page);
  const addNote = async (kind: 'bookmark' | 'note' | 'panel' | 'quote', note = '', quote?: string) => {
    if (!user) return toast('Sign in to save bookmarks', 'info');
    if (kind === 'bookmark' && bookmarked) {
      const b = notes.data!.find((n) => n.kind === 'bookmark' && n.page === page);
      await api.del(`/reading/annotations/${b.id}`);
    } else {
      await api.post('/reading/annotations', { titleId: title.id, chapterId: chapter.id, page, kind, note, quote });
      toast(kind === 'bookmark' ? `Bookmarked page ${page + 1}` : kind === 'quote' ? 'Quote saved' : kind === 'panel' ? 'Panel saved' : 'Note saved', 'success');
    }
    notes.refetch();
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      const fwd = rtl ? -1 : 1;
      const map: Record<string, () => void> = {
        ArrowRight: () => (mode === 'paged' || mode === 'double' ? turn(fwd as 1 | -1) : undefined),
        ArrowLeft: () => (mode === 'paged' || mode === 'double' ? turn((-fwd) as 1 | -1) : undefined),
        d: () => turn(fwd as 1 | -1), a: () => turn((-fwd) as 1 | -1),
        ArrowDown: () => (mode === 'paged' || mode === 'double' ? turn(1) : undefined),
        ArrowUp: () => (mode === 'paged' || mode === 'double' ? turn(-1) : undefined),
        ' ': () => turn(e.shiftKey ? -1 : 1), PageDown: () => turn(1), PageUp: () => turn(-1),
        AudioVolumeDown: () => turn(1), AudioVolumeUp: () => turn(-1),
        Home: () => (mode === 'paged' || mode === 'double' ? setPage(0) : scrollRef.current?.scrollTo({ top: 0 })),
        End: () => (mode === 'paged' || mode === 'double' ? setPage(total - 1) : scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })),
        ']': () => goChapter(nextCh), '[': () => goChapter(prevCh), n: () => goChapter(nextCh), p: () => goChapter(prevCh),
        f: toggleFullscreen, b: () => addNote('bookmark'), c: () => setPanel((x) => (x === 'comments' ? null : 'comments')),
        s: () => setPanel((x) => (x === 'settings' ? null : 'settings')), m: toggleUi, Escape: () => (panel ? setPanel(null) : nav(-1)),
      };
      const fn = map[e.key] ?? map[e.key.toLowerCase()];
      if (fn && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // ---------- auto-scroll ----------
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    let raf = 0, last = performance.now();
    const speed = (isNovel ? novel.scrollSpeed : profile.scrollSpeed) / 10; // px per second
    const tick = (t: number) => {
      scrollRef.current?.scrollBy(0, ((t - last) / 1000) * speed);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll, isNovel, novel.scrollSpeed, profile.scrollSpeed]);

  if (pages.kind === 'external') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-xl font-semibold">{chapterLabel(chapter)}</h1>
        <p className="text-muted max-w-md">This chapter is published on the official site. Reading it there supports the creators.</p>
        <a href={pages.url} target="_blank" rel="noopener noreferrer" className="btn-primary"><ExternalLink className="h-4 w-4" />Open official site</a>
        <Link to={`/title/${enc(title.id)}`} className="btn-ghost">Back to title</Link>
      </div>
    );
  }

  const bg = isNovel ? (novel.theme === 'custom' ? novel.background : NOVEL_THEMES[novel.theme]?.bg) : profile.background;
  const brightness = isNovel ? novel.brightness : profile.brightness;
  const showProgress = isNovel ? true : profile.showProgress;

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: bg }} onMouseMove={() => profile.toolbar === 'auto' && (setUi(true), poke())}>
      {/* Content */}
      {mode === 'novel' ? (
        <NovelView html={(pages as any).html} profile={novel} scrollRef={scrollRef} resume={data.resume?.completed ? 0 : data.resume?.scroll ?? 0}
          onScroll={(f) => { scrollFrac.current = f; if (f > 0.97) setAtEnd(true); }} onTap={toggleUi} onQuote={(text) => addNote('quote', '', text)} end={<EndCard next={nextCh} title={title} onNext={() => goChapter(nextCh)} color={novel.theme === 'custom' ? novel.textColor : NOVEL_THEMES[novel.theme]?.fg} />} />
      ) : mode === 'paged' || mode === 'double' ? (
        <PagedView imgs={imgs} page={page} profile={profile} double={mode === 'double'} rtl={rtl} atEnd={atEnd}
          onTurn={turn} onCenter={toggleUi} onSwipe={(dx) => turn(((dx < 0) !== rtl ? 1 : -1) as 1 | -1)}
          end={<EndCard next={nextCh} title={title} onNext={() => goChapter(nextCh)} onBack={() => setAtEnd(false)} />} />
      ) : (
        <ScrollView imgs={imgs} profile={profile} webtoon={mode === 'webtoon'} scrollRef={scrollRef} initialPage={page}
          onPage={(p) => { setPage(p); sessionRef.current?.pageTurned(); }} onEnd={() => setAtEnd(true)} onTap={toggleUi}
          onScrollFrac={(f) => { scrollFrac.current = f; }}
          end={<EndCard next={nextCh} title={title} onNext={() => goChapter(nextCh)} />} />
      )}

      {brightness > 0 && <div className="pointer-events-none fixed inset-0 bg-black" style={{ opacity: brightness }} />}

      {/* Minimal progress line when toolbars are hidden */}
      {showProgress && !ui && total > 1 && <div className="fixed bottom-0 inset-x-0 h-0.5 bg-white/10 pointer-events-none"><div className="h-full bg-primary/80 transition-all" style={{ width: `${((page + 1) / total) * 100}%`, marginLeft: rtl ? 'auto' : undefined }} /></div>}

      {/* Top toolbar */}
      <div className={cls('fixed top-0 inset-x-0 z-20 transition-transform duration-200', ui ? 'translate-y-0' : '-translate-y-full')}>
        <div className="flex items-center gap-1 px-2 h-14 bg-black/80 text-white backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <Link to={`/title/${enc(title.id)}`} className="h-10 w-10 inline-flex items-center justify-center rounded hover:bg-white/10" aria-label="Back to title"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="min-w-0 flex-1 px-1">
            <div className="text-sm font-medium truncate">{title.title}</div>
            <div className="text-xs text-white/60 truncate">{chapterLabel(chapter)}{chapter.group ? ` · ${chapter.group}` : ''}{offline && ' · offline copy'}</div>
          </div>
          {offline && <WifiOff className="h-4 w-4 text-white/60 mx-1" aria-label="Reading offline copy" />}
          {mode !== 'paged' && mode !== 'double' && <TB label={autoScroll ? 'Pause auto-scroll' : 'Auto-scroll'} onClick={() => setAutoScroll(!autoScroll)}>{autoScroll ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</TB>}
          <TB label={bookmarked ? 'Remove bookmark (B)' : 'Bookmark page (B)'} onClick={() => addNote('bookmark')}>{bookmarked ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}</TB>
          <TB label="Notes & bookmarks" onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><NotebookPen className="h-5 w-5" /></TB>
          {!offline && <TB label="Chapter comments (C)" onClick={() => setPanel(panel === 'comments' ? null : 'comments')}><MessageSquare className="h-5 w-5" /></TB>}
          <TB label="Chapters" onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')}><List className="h-5 w-5" /></TB>
          <TB label="Reader settings (S)" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Settings2 className="h-5 w-5" /></TB>
          <TB label={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onClick={toggleFullscreen}>{fullscreen ? <Shrink className="h-5 w-5" /> : <Expand className="h-5 w-5" />}</TB>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className={cls('fixed bottom-0 inset-x-0 z-20 transition-transform duration-200', ui ? 'translate-y-0' : 'translate-y-full')}>
        <div className="flex items-center gap-2 px-3 h-16 bg-black/80 text-white backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <TB label="Previous chapter ([)" onClick={() => goChapter(rtl ? nextCh : prevCh)} disabled={!(rtl ? nextCh : prevCh)}><ChevronLeft className="h-5 w-5" /></TB>
          {total > 1 && !isNovel ? (
            <>
              <span className="text-xs tabular-nums w-12 text-right">{page + 1}/{total}</span>
              <input type="range" min={0} max={total - 1} value={page} dir={rtl ? 'rtl' : 'ltr'} aria-label="Page"
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setAtEnd(false);
                  setPage(p);
                  if (mode === 'vertical' || mode === 'webtoon') scrollRef.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView();
                }} className="flex-1 accent-[rgb(var(--c-primary))]" />
            </>
          ) : <div className="flex-1 text-center text-xs text-white/60">{TYPE_LABEL[title.type]} · {chapterLabel(chapter, false)}</div>}
          <TB label="Next chapter (])" onClick={() => goChapter(rtl ? prevCh : nextCh)} disabled={!(rtl ? prevCh : nextCh)}><ChevronRight className="h-5 w-5" /></TB>
        </div>
      </div>

      {/* Side panels */}
      {panel && (
        <div className="fixed inset-0 z-30 flex justify-end" onClick={() => setPanel(null)}>
          <div className="h-full w-full sm:w-[420px] panel rounded-none border-y-0 border-r-0 overflow-y-auto shadow-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={panel}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 border-b border-border bg-surface">
              <h2 className="font-display font-semibold capitalize">{panel === 'notes' ? 'Bookmarks & notes' : panel === 'settings' ? `Reader · ${isNovel ? 'Light novel' : TYPE_LABEL[title.type]}` : panel}</h2>
              <button className="btn-icon" onClick={() => { setPanel(null); if (params.get('comments')) setParams({}, { replace: true }); }} aria-label="Close panel"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4">
              {panel === 'settings' && (isNovel ? <NovelSettings p={novel} set={setProfile} /> : <MangaSettings p={profile} set={setProfile} />)}
              {panel === 'chapters' && (
                <ul className="-mx-2">{[...sorted].reverse().map((c) => (
                  <li key={c.id}><button onClick={() => goChapter(c)} className={cls('w-full text-left px-2 py-2 rounded text-sm hover:bg-hover/[0.06]', c.id === chapter.id && 'bg-primary/15 font-medium')}>
                    {chapterLabel(c)}<span className="block text-xs text-muted">{[c.language, c.group].filter(Boolean).join(' · ')}</span></button></li>
                ))}</ul>
              )}
              {panel === 'notes' && <NotesPanel notes={notes.data ?? []} page={page} isNovel={isNovel} onAdd={addNote} onJump={(p) => { setPage(p); setAtEnd(false); setPanel(null); scrollRef.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView(); }} onDelete={(id) => api.del(`/reading/annotations/${id}`).then(() => notes.refetch())} signedIn={!!user} />}
              {panel === 'comments' && <Comments targetType="chapter" targetId={chapter.id} compact />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TB = ({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) => (
  <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="h-10 w-10 inline-flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30">{children}</button>
);

function fitStyle(fit: ReaderProfile['fit'], double = false): CSSProperties {
  switch (fit) {
    case 'width': return { width: double ? '50vw' : '100vw', maxWidth: double ? '50vw' : '100vw', height: 'auto' };
    case 'height': return { height: '100vh', width: 'auto', maxWidth: 'none' };
    case 'original': return { maxWidth: 'none' };
    default: return { maxHeight: '100vh', maxWidth: double ? '50vw' : '100vw', objectFit: 'contain' };
  }
}

function Img({ page, style, className = '', index, eager }: { page: { url: string; fallbackUrl?: string }; style?: CSSProperties; className?: string; index: number; eager?: boolean }) {
  const [src, setSrc] = useState(page.url);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="relative flex items-center justify-center" data-page={index} style={{ minHeight: state === 'ok' ? undefined : '60vh' }}>
      {state === 'loading' && <Spinner className="h-6 w-6 absolute text-white/40" />}
      {state === 'error' ? (
        <button className="flex flex-col items-center gap-2 text-white/60 text-sm py-20" onClick={() => { setState('loading'); setAttempt((a) => a + 1); setSrc(page.url + (page.url.includes('?') ? '&' : '?') + `r=${attempt + 1}`); }}>
          <RotateCcw className="h-6 w-6" />Page {index + 1} failed to load — tap to retry
        </button>
      ) : (
        <img src={src} alt={`Page ${index + 1}`} draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" style={style} className={cls('block select-none', className)}
          onLoad={() => setState('ok')} onError={() => { if (page.fallbackUrl && src !== page.fallbackUrl) setSrc(page.fallbackUrl); else setState('error'); }} />
      )}
    </div>
  );
}

function PagedView({ imgs, page, profile, double, rtl, atEnd, onTurn, onCenter, onSwipe, end }: {
  imgs: { url: string; fallbackUrl?: string }[]; page: number; profile: ReaderProfile; double: boolean; rtl: boolean; atEnd: boolean;
  onTurn: (d: 1 | -1) => void; onCenter: () => void; onSwipe: (dx: number) => void; end: React.ReactNode;
}) {
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  // Preload the next few pages.
  useEffect(() => {
    for (let i = 1; i <= profile.preload; i++) { const p = imgs[page + i]; if (p) { const im = new Image(); im.src = p.url; } }
  }, [page, imgs, profile.preload]);
  // Double mode: page 0 (cover) alone, then pairs.
  const spread = double ? (page === 0 ? [0] : [page, page + 1].filter((i) => i < imgs.length)) : [page];
  const ordered = rtl ? [...spread].reverse() : spread;
  const onClick = (e: React.MouseEvent) => {
    if (!profile.tapZones) return onCenter();
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) onTurn(rtl ? 1 : -1);
    else if (x > 0.7) onTurn(rtl ? -1 : 1);
    else onCenter();
  };
  const anim = profile.transition === 'none' ? '' : profile.transition === 'fade' ? 'animate-[fadein_.2s_ease]' : 'animate-[slidein_.2s_ease]';
  return (
    <div className="absolute inset-0 overflow-auto flex" onClick={onClick}
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() })}
      onTouchEnd={(e) => {
        const s = touch.current; touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 600) { e.preventDefault(); onSwipe(dx); }
      }}>
      <style>{'@keyframes fadein{from{opacity:0}to{opacity:1}}@keyframes slidein{from{opacity:.4;transform:translateX(' + (rtl ? '-' : '') + '24px)}to{opacity:1;transform:none}}'}</style>
      {atEnd ? end : (
        <div key={page} className={cls('m-auto flex items-center justify-center', anim)} style={{ padding: profile.margins }}>
          {ordered.map((i) => <Img key={i} index={i} page={imgs[i]} style={fitStyle(profile.fit, double && spread.length > 1)} eager />)}
        </div>
      )}
    </div>
  );
}

function ScrollView({ imgs, profile, webtoon, scrollRef, initialPage, onPage, onEnd, onTap, onScrollFrac, end }: {
  imgs: { url: string; fallbackUrl?: string }[]; profile: ReaderProfile; webtoon: boolean; scrollRef: React.RefObject<HTMLDivElement>; initialPage: number;
  onPage: (p: number) => void; onEnd: () => void; onTap: () => void; onScrollFrac: (f: number) => void; end: React.ReactNode;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const current = useRef(initialPage);
  useEffect(() => {
    const root = scrollRef.current!;
    if (initialPage > 0) setTimeout(() => root.querySelector(`[data-page="${initialPage}"]`)?.scrollIntoView(), 50);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (e.target === endRef.current) { onEnd(); continue; }
        const p = Number((e.target as HTMLElement).dataset.page);
        if (!Number.isNaN(p) && p !== current.current) { current.current = p; onPage(p); }
      }
    }, { root, rootMargin: '-45% 0px -45% 0px' });
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    const endIo = new IntersectionObserver((e) => e[0].isIntersecting && onEnd(), { root, threshold: 0.3 });
    if (endRef.current) endIo.observe(endRef.current);
    return () => { io.disconnect(); endIo.disconnect(); };
  }, [imgs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxW = webtoon ? 'min(100vw, 800px)' : profile.fit === 'width' ? '100vw' : 'min(100vw, 1000px)';
  return (
    <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-contain" onClick={onTap}
      onScroll={(e) => { const el = e.currentTarget; onScrollFrac(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)); }}>
      <div className="mx-auto flex flex-col" style={{ maxWidth: maxW, gap: webtoon ? 0 : profile.spacing, padding: webtoon ? 0 : profile.margins }}>
        {imgs.map((p, i) => <Img key={i} index={i} page={p} eager={i < 3} style={{ width: '100%', height: 'auto' }} />)}
      </div>
      <div ref={endRef}>{end}</div>
    </div>
  );
}

function NovelView({ html, profile, scrollRef, resume, onScroll, onTap, onQuote, end }: {
  html: string; profile: NovelProfile; scrollRef: React.RefObject<HTMLDivElement>; resume: number; onScroll: (f: number) => void; onTap: () => void; onQuote: (t: string) => void; end: React.ReactNode;
}) {
  const theme = profile.theme === 'custom' ? { bg: profile.background, fg: profile.textColor } : NOVEL_THEMES[profile.theme];
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current!;
    if (resume > 0) requestAnimationFrame(() => (el.scrollTop = resume * (el.scrollHeight - el.clientHeight)));
    // A chapter that fits on one screen can't be scrolled to the end; count it as read after a while.
    const t = setTimeout(() => { if (el.scrollHeight <= el.clientHeight + 8) onScroll(1); }, 20_000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fonts: Record<string, string> = { Literata: "'Literata', Georgia, serif", Inter: "'Inter', sans-serif", Georgia: 'Georgia, serif', Atkinson: "'Atkinson Hyperlegible', sans-serif", System: 'system-ui, sans-serif' };
  return (
    <div ref={scrollRef} className="absolute inset-0 overflow-y-auto select-text" style={{ background: theme.bg, color: theme.fg }}
      onScroll={(e) => { const el = e.currentTarget; onScroll(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)); setSel(null); }}
      onMouseUp={() => { const s = window.getSelection(); const t = s?.toString().trim(); if (t && t.length > 3) { const r = s!.getRangeAt(0).getBoundingClientRect(); setSel({ text: t.slice(0, 2000), x: r.left + r.width / 2, y: r.top }); } else setSel(null); }}
      onClick={(e) => { if (!window.getSelection()?.toString() && (e.target as HTMLElement).tagName !== 'BUTTON') onTap(); }}>
      <article className="novel-text mx-auto px-5 pt-20 pb-10" style={{
        maxWidth: `${profile.width}ch`, fontFamily: fonts[profile.font], fontSize: profile.fontSize, lineHeight: profile.lineHeight, textAlign: profile.align,
        ['--para' as any]: `${profile.paragraphSpacing}em`, ['--indent' as any]: profile.indent ? '1.5em' : '0',
      }} dangerouslySetInnerHTML={{ __html: html }} />
      {end}
      {sel && (
        <button className="fixed z-40 btn-primary h-8 -translate-x-1/2 -translate-y-full shadow-card" style={{ left: sel.x, top: sel.y - 8 }}
          onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onQuote(sel.text); setSel(null); window.getSelection()?.removeAllRanges(); }}>
          <Quote className="h-4 w-4" />Save quote
        </button>
      )}
    </div>
  );
}

function EndCard({ next, title, onNext, onBack, color = '#ffffff' }: { next?: Chapter; title: Loaded['title']; onNext: () => void; onBack?: () => void; color?: string }) {
  return (
    <div className="m-auto py-20 px-6 text-center max-w-sm" style={{ color }} onClick={(e) => e.stopPropagation()}>
      <p className="text-sm opacity-60">End of chapter</p>
      {next ? (
        <>
          <p className="mt-4 text-xs uppercase tracking-widest opacity-50">Up next</p>
          <p className="font-display text-xl font-semibold mt-1">{chapterLabel(next)}</p>
          <button className="btn-primary mt-5 h-11 px-6" onClick={onNext}>{next.externalUrl ? 'Open on official site' : 'Read next chapter'}<ChevronRight className="h-4 w-4" /></button>
        </>
      ) : <p className="font-display text-xl font-semibold mt-3">You're all caught up!</p>}
      <div className="mt-4 flex justify-center gap-2">
        {onBack && <button className="btn-ghost" style={{ color }} onClick={onBack}>Back to last page</button>}
        <Link to={`/title/${enc(title.id)}`} className="btn-ghost" style={{ color }}>Title page</Link>
      </div>
    </div>
  );
}

function MangaSettings({ p, set }: { p: ReaderProfile; set: (x: Partial<ReaderProfile>) => void }) {
  return (
    <div className="space-y-4 text-sm">
      <div><span className="label">Reading mode</span><Segmented size="sm" value={p.mode} onChange={(mode) => set({ mode })} options={[{ value: 'paged', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'vertical', label: 'Vertical' }, { value: 'webtoon', label: 'Webtoon' }]} /></div>
      {(p.mode === 'paged' || p.mode === 'double') && <div><span className="label">Direction</span><Segmented size="sm" value={p.direction} onChange={(direction) => set({ direction })} options={[{ value: 'rtl', label: 'Right to left' }, { value: 'ltr', label: 'Left to right' }]} /></div>}
      <div><span className="label">Image scaling</span><Segmented size="sm" value={p.fit} onChange={(fit) => set({ fit })} options={[{ value: 'screen', label: 'Fit screen' }, { value: 'width', label: 'Fit width' }, { value: 'height', label: 'Fit height' }, { value: 'original', label: 'Original' }]} /></div>
      {(p.mode === 'paged' || p.mode === 'double') && <div><span className="label">Page transition</span><Segmented size="sm" value={p.transition} onChange={(transition) => set({ transition })} options={[{ value: 'slide', label: 'Slide' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }]} /></div>}
      <div><span className="label">Toolbar</span><Segmented size="sm" value={p.toolbar} onChange={(toolbar) => set({ toolbar })} options={[{ value: 'auto', label: 'Auto-hide' }, { value: 'always', label: 'Always' }, { value: 'hidden', label: 'Hidden' }]} /></div>
      <div>
        <span className="label">Background</span>
        <div className="flex gap-2 items-center">{['#000000', '#0b0b0f', '#1c1c22', '#808080', '#f2efe8', '#ffffff'].map((c) => <button key={c} onClick={() => set({ background: c })} aria-label={`Background ${c}`} className={cls('h-8 w-8 rounded-full border-2', p.background === c ? 'border-primary' : 'border-border')} style={{ background: c }} />)}
          <input type="color" value={p.background} onChange={(e) => set({ background: e.target.value })} className="h-8 w-8 rounded-full bg-transparent" aria-label="Custom background" /></div>
      </div>
      <Range label="Darken (brightness)" value={p.brightness} min={0} max={0.8} step={0.05} onChange={(brightness) => set({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
      <Range label="Page margins" value={p.margins} min={0} max={80} onChange={(margins) => set({ margins })} format={(v) => `${v}px`} />
      {p.mode === 'vertical' && <Range label="Page spacing" value={p.spacing} min={0} max={60} onChange={(spacing) => set({ spacing })} format={(v) => `${v}px`} />}
      <Range label="Scroll speed" value={p.scrollSpeed} min={100} max={1500} step={50} onChange={(scrollSpeed) => set({ scrollSpeed })} />
      <Range label="Preload pages" value={p.preload} min={0} max={10} onChange={(preload) => set({ preload })} />
      <Toggle label="Tap zones" description="Tap the left/right edges to turn pages, the center to show controls." checked={p.tapZones} onChange={(tapZones) => set({ tapZones })} />
      <Toggle label="Automatic chapter progression" checked={p.autoNext} onChange={(autoNext) => set({ autoNext })} />
      {p.autoNext && <div><span className="label">At the end of a chapter</span><Segmented size="sm" value={p.chapterTransition} onChange={(chapterTransition) => set({ chapterTransition })} options={[{ value: 'confirm', label: 'Show next-chapter card' }, { value: 'auto', label: 'Go to next automatically' }]} /></div>}
      <Toggle label="Immersive mode" description="Start with controls hidden." checked={p.immersive} onChange={(immersive) => set({ immersive })} />
      <Toggle label="Show progress line" checked={p.showProgress} onChange={(showProgress) => set({ showProgress })} />
      <Toggle label="Data saver" description="Lower-quality images where the source offers them." checked={p.dataSaver} onChange={(dataSaver) => set({ dataSaver })} />
      <KeyHelp />
    </div>
  );
}

function NovelSettings({ p, set }: { p: NovelProfile; set: (x: Partial<NovelProfile>) => void }) {
  return (
    <div className="space-y-4 text-sm">
      <div><span className="label">Theme</span><Segmented size="sm" value={p.theme} onChange={(theme) => set({ theme })} options={[{ value: 'dark', label: 'Dark' }, { value: 'black', label: 'Black' }, { value: 'sepia', label: 'Sepia' }, { value: 'light', label: 'Light' }, { value: 'custom', label: 'Custom' }]} /></div>
      {p.theme === 'custom' && <div className="flex gap-4"><label className="flex items-center gap-2">Text<input type="color" value={p.textColor} onChange={(e) => set({ textColor: e.target.value })} /></label><label className="flex items-center gap-2">Background<input type="color" value={p.background} onChange={(e) => set({ background: e.target.value })} /></label></div>}
      <div><span className="label">Font</span><Select value={p.font} onChange={(font) => set({ font })} options={['Literata', 'Georgia', 'Inter', 'Atkinson', 'System'].map((f) => ({ value: f as NovelProfile['font'], label: f }))} /></div>
      <Range label="Font size" value={p.fontSize} min={13} max={32} onChange={(fontSize) => set({ fontSize })} format={(v) => `${v}px`} />
      <Range label="Line height" value={p.lineHeight} min={1.2} max={2.4} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
      <Range label="Line width" value={p.width} min={40} max={110} onChange={(width) => set({ width })} format={(v) => `${v} ch`} />
      <Range label="Paragraph spacing" value={p.paragraphSpacing} min={0} max={2.5} step={0.1} onChange={(paragraphSpacing) => set({ paragraphSpacing })} format={(v) => `${v}em`} />
      <Range label="Darken (brightness)" value={p.brightness} min={0} max={0.8} step={0.05} onChange={(brightness) => set({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
      <Range label="Auto-scroll speed" value={p.scrollSpeed} min={50} max={1500} step={50} onChange={(scrollSpeed) => set({ scrollSpeed })} />
      <div><span className="label">Alignment</span><Segmented size="sm" value={p.align} onChange={(align) => set({ align })} options={[{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justified' }]} /></div>
      <Toggle label="Indent paragraphs" checked={p.indent} onChange={(indent) => set({ indent })} />
      <Toggle label="Automatic chapter progression" checked={p.autoNext} onChange={(autoNext) => set({ autoNext })} />
      <p className="text-xs text-muted">Select any passage to save it as a quote.</p>
      <KeyHelp />
    </div>
  );
}

const KeyHelp = () => (
  <details className="text-xs text-muted">
    <summary className="cursor-pointer">Keyboard shortcuts</summary>
    <ul className="mt-2 space-y-1">
      <li>← → / A D — turn pages (follows reading direction)</li><li>Space / Shift+Space — next / previous</li><li>[ ] or P N — previous / next chapter</li>
      <li>B — bookmark · C — comments · S — settings · M — toggle menu</li><li>F — fullscreen · Esc — close panel / go back</li><li>Volume keys turn pages where the device reports them</li>
    </ul>
  </details>
);

function NotesPanel({ notes, page, isNovel, onAdd, onJump, onDelete, signedIn }: { notes: any[]; page: number; isNovel: boolean; onAdd: (k: 'note' | 'panel', n: string) => void; onJump: (p: number) => void; onDelete: (id: string) => void; signedIn: boolean }) {
  const [text, setText] = useState('');
  if (!signedIn) return <p className="text-sm text-muted">Sign in to save bookmarks and notes.</p>;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <textarea className="textarea" rows={3} placeholder={isNovel ? 'Write a note for this chapter…' : `Note for page ${page + 1}…`} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-primary h-8" disabled={!text.trim()} onClick={() => { onAdd('note', text); setText(''); }}>Save note</button>
          {!isNovel && <button className="btn-outline h-8" onClick={() => onAdd('panel', text)}>Save page {page + 1} as favorite panel</button>}
        </div>
      </div>
      {!notes.length ? <p className="text-sm text-muted">No bookmarks or notes in this chapter yet.</p> : (
        <ul className="space-y-2">{notes.map((n) => (
          <li key={n.id} className="card p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-primary">{n.kind}</span>
              {!isNovel && <button className="text-xs link" onClick={() => onJump(n.page)}>Page {n.page + 1}</button>}
              <div className="flex-1" />
              <button className="btn-icon h-7 w-7" onClick={() => onDelete(n.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            {n.quote && <blockquote className="mt-1 border-l-2 border-primary pl-2 italic text-muted">{n.quote}</blockquote>}
            {n.note && <p className="mt-1 whitespace-pre-line">{n.note}</p>}
          </li>
        ))}</ul>
      )}
      <Link to="/library?tab=annotations" className="text-xs link">All bookmarks across your library →</Link>
    </div>
  );
}

