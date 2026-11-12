import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownUp, Bell, BellOff, BookOpen, CheckCheck, CircleDashed, Download, ExternalLink, MessageSquare, Play, RefreshCw, Star, Users } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { chapterLabel, cls, num, STATUS_LABEL, timeAgo, TYPE_LABEL } from '@/lib/format';
import type { Chapter, Entry, Title } from '@/lib/types';
import { enqueue } from '@/lib/offline';
import { openExternal } from '@/lib/native';
import { Avatar, Cover, ErrorState, Modal, PageLoader, RichText, Select, Spinner, Spoiler, Stars, Tabs, UserLink } from '@/components/ui';
import { AddToListButton, LibraryButton, ReportButton, TitleCard, TitleRow, titleHref } from '@/components/titles';

interface TitleResp {
  title: Title;
  source: { id: string; name: string; kind: string; website?: string; download: boolean };
  community: { members: number; avgRating: number | null; ratings: number; favorites: number; reading: number; completed: number; threads: number; reviews: number };
  entry: Entry | null;
}
interface ChaptersResp { chapters: Chapter[]; stale: boolean; error?: string; progress: Record<string, { page: number; totalPages: number; completed: boolean; updatedAt: string }>; commentCounts: Record<string, number> }

export default function TitlePage() {
  const id = useParams().id!;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'chapters';
  const q = useQuery({ queryKey: ['title', id], queryFn: () => api.get<TitleResp>(`/titles/${enc(id)}`) });
  const [expand, setExpand] = useState(false);
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { title: t, source, community, entry } = q.data!;

  return (
    <div className="-mt-5">
      <div className="relative -mx-4 h-44 sm:h-64 overflow-hidden">
        {(t.bannerUrl || t.coverUrl) && <img src={t.bannerUrl ?? t.coverUrl!} alt="" className="absolute inset-0 h-full w-full object-cover" style={t.bannerUrl ? undefined : { filter: 'blur(30px) saturate(1.3)', transform: 'scale(1.2)' }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
      </div>
      <div className="relative -mt-28 sm:-mt-40 flex flex-col sm:flex-row gap-5 sm:gap-8">
        <Cover src={t.coverUrl} alt={t.title} className="w-36 sm:w-52 shadow-card shrink-0 mx-auto sm:mx-0 ring-1 ring-border" />
        <div className="flex-1 min-w-0 sm:pt-24">
          <div className="flex flex-wrap gap-2 text-xs mb-2">
            <span className="rounded px-2 py-0.5 bg-primary/15 text-primary font-medium">{TYPE_LABEL[t.type]}</span>
            {t.status && <span className="rounded px-2 py-0.5 bg-surface-2 capitalize">{t.status}</span>}
            {t.year && <span className="rounded px-2 py-0.5 bg-surface-2">{t.year}</span>}
            {t.demographic && <span className="rounded px-2 py-0.5 bg-surface-2 capitalize">{t.demographic}</span>}
            {t.contentRating && t.contentRating !== 'safe' && <span className="rounded px-2 py-0.5 bg-warning/15 text-warning capitalize">{t.contentRating}</span>}
          </div>
          <h1 className="font-display text-2xl sm:text-4xl font-bold leading-tight">{t.title}</h1>
          {t.altTitles.length > 0 && <p className="text-sm text-muted mt-1 line-clamp-1" title={t.altTitles.join(' · ')}>{t.altTitles.slice(0, 3).join(' · ')}</p>}
          <p className="text-sm mt-2">
            {t.authors.length > 0 && <>By {t.authors.map((a, i) => <span key={a}>{i > 0 && ', '}<Link to={`/discover/search?author=${enc(a)}`} className="hover:text-primary">{a}</Link></span>)}</>}
            {t.artists.length > 0 && t.artists.join() !== t.authors.join() && <span className="text-muted"> · Art by {t.artists.join(', ')}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-sm text-muted">
            {t.sourceRating != null && <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-warning text-warning" /><b className="text-fg">{t.sourceRating.toFixed(2)}</b> on {source.name}</span>}
            {community.avgRating != null && <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 text-primary" /><b className="text-fg">{community.avgRating.toFixed(1)}</b> Kimoto ({community.ratings})</span>}
            <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" />{num(community.members)} readers</span>
            {t.chapterCount != null && <span className="inline-flex items-center gap-1"><BookOpen className="h-4 w-4" />{t.chapterCount} chapters</span>}
            {t.sourceFollows != null && <span>{num(t.sourceFollows)} follows</span>}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <ReadButton title={t} entry={entry} />
            <LibraryButton title={t} entry={entry} />
            <AddToListButton title={t} />
            {entry && <NotifyToggle title={t} entry={entry} />}
          </div>
          <OfficialLinks links={t.links} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-8 mt-8">
        <div className="min-w-0">
          {t.description && (
            <div className="mb-6">
              <p className={cls('text-sm leading-relaxed whitespace-pre-line text-fg/90', !expand && 'line-clamp-4')}>{t.description}</p>
              {t.description.length > 300 && <button className="text-sm link mt-1" onClick={() => setExpand(!expand)}>{expand ? 'Show less' : 'Read more'}</button>}
            </div>
          )}
          <Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-5" tabs={[
            { id: 'chapters', label: t.readable ? 'Chapters' : 'Where to read' },
            { id: 'related', label: 'Related' },
            { id: 'reviews', label: 'Reviews', count: community.reviews },
            { id: 'discussions', label: 'Discussions', count: community.threads },
            { id: 'readers', label: 'Readers' },
          ]} />
          {tab === 'chapters' && (t.readable ? <ChapterList title={t} canDownload={source.download} /> : <ReadableSources title={t} />)}
          {tab === 'related' && <Related title={t} />}
          {tab === 'reviews' && <Reviews title={t} />}
          {tab === 'discussions' && <Discussions title={t} />}
          {tab === 'readers' && <Readers title={t} />}
        </div>
        <aside className="space-y-5">
          <div className="card p-4 text-sm space-y-3">
            <Info label="Source">{source.website ? <a href={source.website} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">{source.name}<ExternalLink className="h-3 w-3" /></a> : source.name}</Info>
            {t.originalLanguage && <Info label="Original language">{t.originalLanguage}</Info>}
            {t.languages.length > 0 && <Info label="Available in">{t.languages.slice(0, 12).join(', ')}{t.languages.length > 12 && ` +${t.languages.length - 12}`}</Info>}
            {Object.keys(t.links).length > 0 && (
              <Info label="Elsewhere">
                <div className="flex flex-wrap gap-2">
                  {t.links.al && <a className="link" target="_blank" rel="noreferrer" href={`https://anilist.co/manga/${t.links.al}`}>AniList</a>}
                  {t.links.mal && <a className="link" target="_blank" rel="noreferrer" href={`https://myanimelist.net/manga/${t.links.mal}`}>MyAnimeList</a>}
                  {t.links.mu && <a className="link" target="_blank" rel="noreferrer" href={/^\d+$/.test(t.links.mu) ? `https://www.mangaupdates.com/series.html?id=${t.links.mu}` : `https://www.mangaupdates.com/series/${t.links.mu}`}>MangaUpdates</a>}
                  {t.links.raw && /^https:/.test(t.links.raw) && <a className="link" target="_blank" rel="noreferrer" href={t.links.raw}>Official raw</a>}
                  {t.links.engtl && /^https:/.test(t.links.engtl) && <a className="link" target="_blank" rel="noreferrer" href={t.links.engtl}>Official English</a>}
                </div>
              </Info>
            )}
            <Info label="Community">{community.reading} reading · {community.completed} completed · {community.favorites} favorites</Info>
          </div>
          {t.genres.length > 0 && <div><h3 className="label">Genres</h3><div className="flex flex-wrap gap-1.5">{t.genres.map((g) => <Link key={g} to={`/discover/search?genres=${enc(g)}`} className="chip">{g}</Link>)}</div></div>}
          {t.tags.length > 0 && <div><h3 className="label">Tags</h3><div className="flex flex-wrap gap-1.5">{t.tags.slice(0, 24).map((g) => <Link key={g} to={`/discover/search?genres=${enc(g)}`} className="chip">{g}</Link>)}</div></div>}
          {entry && (
            <div className="card p-4 text-sm space-y-2">
              <div className="font-medium">Your entry</div>
              <div className="text-muted">{STATUS_LABEL[entry.status]} · Ch. {entry.progressChapter}{entry.progressVolume ? ` · Vol. ${entry.progressVolume}` : ''}</div>
              {entry.rating && <Stars value={entry.rating} size="sm" />}
              {entry.tags.length > 0 && <div className="flex flex-wrap gap-1">{entry.tags.map((x) => <span key={x} className="chip h-6">{x}</span>)}</div>}
              {entry.notes && <p className="text-muted whitespace-pre-line">{entry.notes}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Official links are stored in `title.links` as "official:<Platform (Language)>" → url. */
function officialLinks(links: Record<string, string>) {
  return Object.entries(links)
    .filter(([k, v]) => k.startsWith('official:') && /^https?:\/\//.test(v))
    .map(([k, url]) => {
      const label = k.slice('official:'.length);
      const [, platform, detail] = label.match(/^(.*?)(?: \((.+)\))?$/) ?? [, label, undefined];
      return { platform: platform!, detail, url };
    });
}

function OfficialLinks({ links, bare }: { links: Record<string, string>; bare?: boolean }) {
  const [all, setAll] = useState(false);
  const list = officialLinks(links);
  if (!list.length) return null;
  // English first, then the rest; collapse long lists.
  const sorted = [...list].sort((a, b) => Number(b.detail === 'English') - Number(a.detail === 'English'));
  const shown = all ? sorted : sorted.slice(0, 5);
  return (
    <div className={cls(!bare && 'mt-4')}>
      {!bare && <div className="text-xs text-muted mb-1.5">Read officially</div>}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((l) => (
          <a key={l.url + l.detail} href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); openExternal(l.url); }}
            className="chip h-8 px-3 text-sm text-fg border-success/40 hover:border-success/70">
            <ExternalLink className="h-3.5 w-3.5 text-success" />{l.platform}{l.detail && <span className="text-muted">· {l.detail}</span>}
          </a>
        ))}
        {sorted.length > 5 && <button className="chip h-8" onClick={() => setAll(!all)}>{all ? 'Show less' : `+${sorted.length - 5} more`}</button>}
      </div>
    </div>
  );
}

const Info = ({ label, children }: { label: string; children: React.ReactNode }) => <div><div className="text-xs text-muted">{label}</div><div className="mt-0.5">{children}</div></div>;

function ReadButton({ title, entry }: { title: Title; entry: Entry | null }) {
  const ch = useQuery({ queryKey: ['chapters', title.id], queryFn: () => api.get<ChaptersResp>(`/titles/${enc(title.id)}/chapters`), enabled: title.readable });
  const nav = useNavigate();
  if (!title.readable) return null;
  const list = [...(ch.data?.chapters ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  if (!list.length) return <button className="btn-primary" disabled>{ch.isLoading ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />}Read</button>;
  const prog = ch.data!.progress;
  const last = entry?.lastChapterId ? list.find((c) => c.id === entry.lastChapterId) : null;
  let target = list[0];
  let label = 'Start reading';
  if (last) {
    if (!prog[last.id]?.completed) { target = last; label = `Continue ${chapterLabel(last, false)}`; }
    else {
      const next = list.find((c) => (c.number ?? 0) > (last.number ?? 0) && c.language === last.language) ?? list.find((c) => (c.number ?? 0) > (last.number ?? 0));
      if (next) { target = next; label = `Read ${chapterLabel(next, false)}`; } else { label = 'Read again'; }
    }
  }
  return <button className="btn-primary" onClick={() => target.externalUrl ? window.open(target.externalUrl, '_blank', 'noopener') : nav(`/read/${enc(target.id)}`)}><Play className="h-4 w-4" />{label}</button>;
}

function NotifyToggle({ title, entry }: { title: Title; entry: Entry }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toggle = async () => {
    await api.put(`/library/${enc(title.id)}`, { notify: !entry.notify });
    qc.invalidateQueries({ queryKey: ['title', title.id] });
    toast(entry.notify ? 'Chapter notifications off for this title' : "You'll be notified about new chapters", 'success');
  };
  return <button className="btn-outline px-2.5" onClick={toggle} aria-label={entry.notify ? 'Turn off chapter notifications' : 'Turn on chapter notifications'} title={entry.notify ? 'Notifications on' : 'Notifications off'}>{entry.notify ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}</button>;
}

function ChapterList({ title, canDownload }: { title: Title; canDownload: boolean }) {
  const { user, prefs } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [lang, setLang] = useState<string>('');
  const [asc, setAsc] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const q = useQuery({ queryKey: ['chapters', title.id], queryFn: () => api.get<ChaptersResp>(`/titles/${enc(title.id)}/chapters`) });
  const langs = useMemo(() => [...new Set((q.data?.chapters ?? []).map((c) => c.language ?? '?'))], [q.data]);
  const chapters = useMemo(() => {
    let c = q.data?.chapters ?? [];
    if (lang) c = c.filter((x) => x.language === lang);
    return asc ? [...c].reverse() : c;
  }, [q.data, lang, asc]);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: chapters.length, getScrollElement: () => parent.current, estimateSize: () => 58, overscan: 12 });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const prog = q.data!.progress;
  const mark = async (read: boolean) => {
    await api.post('/reading/chapters/mark', { titleId: title.id, chapterIds: [...sel], read });
    setSel(new Set()); setSelecting(false);
    qc.invalidateQueries({ queryKey: ['chapters', title.id] }); qc.invalidateQueries({ queryKey: ['title', title.id] });
  };
  const download = async (ids: string[]) => {
    const n = await enqueue(title, (q.data?.chapters ?? []).filter((c) => ids.includes(c.id)), prefs.downloads?.quality === 'saver' ? 'saver' : 'data');
    toast(n ? `Queued ${n} chapter${n === 1 ? '' : 's'} for download` : 'Already downloaded or not downloadable', n ? 'success' : 'info', n ? { label: 'View', onClick: () => location.assign('/downloads') } : undefined);
    setSel(new Set()); setSelecting(false);
  };

  return (
    <div>
      {q.data!.stale && <p className="text-xs text-warning mb-3">Showing cached chapters — the source didn't respond ({q.data!.error}).</p>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {langs.length > 1 && <Select className="w-36" value={lang} onChange={setLang} label="Language" options={[{ value: '', label: 'All languages' }, ...langs.map((l) => ({ value: l, label: l }))]} />}
        <button className="btn-ghost" onClick={() => setAsc(!asc)}><ArrowDownUp className="h-4 w-4" />{asc ? 'Oldest first' : 'Newest first'}</button>
        <button className="btn-ghost" onClick={() => qc.fetchQuery({ queryKey: ['chapters', title.id], queryFn: () => api.get(`/titles/${enc(title.id)}/chapters?refresh=1`) })}><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">Refresh</span></button>
        <div className="flex-1" />
        {user && <button className={selecting ? 'btn-primary' : 'btn-outline'} onClick={() => { setSelecting(!selecting); setSel(new Set()); }}>{selecting ? `${sel.size} selected` : 'Select'}</button>}
        {selecting && <>
          <button className="btn-outline" onClick={() => setSel(new Set(chapters.map((c) => c.id)))}>All</button>
          <button className="btn-outline" disabled={!sel.size} onClick={() => mark(true)}><CheckCheck className="h-4 w-4" />Read</button>
          <button className="btn-outline" disabled={!sel.size} onClick={() => mark(false)}><CircleDashed className="h-4 w-4" />Unread</button>
          {canDownload && <button className="btn-outline" disabled={!sel.size} onClick={() => download([...sel])}><Download className="h-4 w-4" /></button>}
        </>}
      </div>
      <p className="text-xs text-muted mb-2">{chapters.length} chapters{canDownload && !selecting && ' · Use Select to download or mark several at once'}</p>
      {!chapters.length ? <p className="text-sm text-muted py-6">No chapters available in your languages. Change chapter languages in Settings → Reader.</p> : (
        <div ref={parent} className="max-h-[70vh] overflow-y-auto card" role="list">
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((row) => {
              const c = chapters[row.index];
              const p = prog[c.id];
              const read = p?.completed;
              const comments = q.data!.commentCounts[c.id];
              const inner = (
                <>
                  {selecting && <input type="checkbox" checked={sel.has(c.id)} readOnly className="shrink-0" aria-label={`Select ${chapterLabel(c)}`} />}
                  <div className="min-w-0 flex-1">
                    <div className={cls('text-sm truncate', read ? 'text-muted' : 'font-medium')}>{chapterLabel(c)}</div>
                    <div className="text-xs text-muted truncate">
                      {[c.group, c.language, c.publishedAt && timeAgo(c.publishedAt)].filter(Boolean).join(' · ')}
                      {p && !p.completed && p.totalPages > 0 && <span className="text-primary"> · page {p.page + 1}/{p.totalPages}</span>}
                    </div>
                  </div>
                  {comments ? <span className="text-xs text-muted inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{comments}</span> : null}
                  {c.externalUrl && <ExternalLink className="h-4 w-4 text-muted" aria-label="Opens on the official site" />}
                  {!selecting && canDownload && c.downloadable && !c.externalUrl && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); download([c.id]); }} className="btn-icon h-8 w-8" aria-label={`Download ${chapterLabel(c, false)}`}><Download className="h-4 w-4" /></button>}
                </>
              );
              const cn = cls('absolute inset-x-0 flex items-center gap-3 px-3 border-b border-border/50 hover:bg-hover/[0.04]', read && 'opacity-70');
              const style = { top: row.start, height: row.size };
              return selecting ? (
                <button key={c.id} style={style} className={cn + ' text-left'} onClick={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>{inner}</button>
              ) : c.externalUrl ? (
                <a key={c.id} style={style} className={cn} href={c.externalUrl} target="_blank" rel="noopener noreferrer">{inner}</a>
              ) : (
                <Link key={c.id} style={style} className={cn} to={`/read/${enc(c.id)}`}>{inner}</Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadableSources({ title }: { title: Title }) {
  const q = useQuery({ queryKey: ['readable', title.id], queryFn: () => api.get<{ source: string; sourceName: string; title: Title }[]>(`/titles/${enc(title.id)}/readable`) });
  return (
    <div>
      {officialLinks(title.links).length > 0 && (
        <div className="card p-4 mb-5">
          <h3 className="font-medium text-sm mb-1">Read officially</h3>
          <p className="text-xs text-muted mb-3">Licensed releases on the publishers' own sites and apps. Reading there supports the creators.</p>
          <OfficialLinks links={title.links} bare />
        </div>
      )}
      <p className="text-sm text-muted mb-4">This catalog provides information only. Here are matching titles on your enabled reading sources:</p>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <div className="card p-5 text-sm text-muted">No readable copies found on your enabled sources. Try enabling more sources in <Link to="/settings/sources" className="link">Settings → Sources</Link>, or look for an official release{title.links.engtl ? <> — <a href={title.links.engtl} className="link" target="_blank" rel="noreferrer">official English</a></> : ''}.</div>
      ) : (
        <div className="space-y-2">{q.data.map((m) => (
          <Link key={m.title.id} to={titleHref(m.title)} className="card p-3 flex items-center gap-3 hover:border-primary/50">
            <Cover src={m.title.coverUrl} alt={m.title.title} className="w-12" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{m.title.title}</div><div className="text-xs text-muted">{m.sourceName} · {m.title.chapterCount ?? '?'} chapters · {m.title.languages.slice(0, 4).join(', ')}</div></div>
            <BookOpen className="h-4 w-4 text-primary" />
          </Link>
        ))}</div>
      )}
    </div>
  );
}

function Related({ title }: { title: Title }) {
  const q = useQuery({ queryKey: ['related', title.id], queryFn: () => api.get<Title[]>(`/titles/${enc(title.id)}/related`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <p className="text-sm text-muted">No related titles or recommendations from this source.</p>;
  return <TitleRow>{q.data.map((t) => <TitleCard key={t.id} title={t} />)}</TitleRow>;
}

function Reviews({ title }: { title: Title }) {
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['reviews', title.id], queryFn: () => api.get<any[]>(`/titles/${enc(title.id)}/reviews`) });
  const mine = q.data?.find((r) => r.mine);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ rating: 8, body: '', spoiler: false });
  const save = async () => {
    try { await api.put(`/titles/${enc(title.id)}/reviews`, form); setOpen(false); q.refetch(); toast('Review published', 'success'); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div>
      {user && <button className="btn-outline mb-4" onClick={() => { setForm(mine ? { rating: mine.rating, body: mine.body, spoiler: mine.spoiler } : form); setOpen(true); }}>{mine ? 'Edit your review' : 'Write a review'}</button>}
      {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-muted">No reviews yet.</p> : (
        <div className="space-y-4">{q.data.map((r) => (
          <article key={r.id} className="card p-4">
            <div className="flex items-center gap-3 mb-2"><Avatar user={r.user} size={30} /><div className="flex-1"><UserLink user={r.user} /><div className="text-xs text-muted">{timeAgo(r.createdAt)}</div></div>
              <span className="inline-flex items-center gap-1 font-display font-semibold"><Star className="h-4 w-4 fill-warning text-warning" />{r.rating}/10</span></div>
            <div className="text-sm leading-relaxed">{r.spoiler ? <Spoiler label="Review contains spoilers"><RichText text={r.body} /></Spoiler> : <RichText text={r.body} />}</div>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted">
              {!r.mine && user && <button className="hover:text-fg" onClick={() => api.post(`/reviews/${r.id}/helpful`).then(() => q.refetch())}>Helpful ({r.helpful})</button>}
              {r.mine && <button className="hover:text-danger" onClick={() => api.del(`/reviews/${r.id}`).then(() => q.refetch())}>Delete</button>}
              {!r.mine && <ReportButton targetType="review" targetId={r.id} />}
            </div>
          </article>
        ))}</div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Your review" footer={<button className="btn-primary" onClick={save}>Publish</button>}>
        <div className="space-y-3">
          <Stars value={form.rating} onChange={(v) => setForm({ ...form, rating: v ?? 1 })} />
          <textarea className="textarea" rows={8} placeholder="What worked, what didn't? (20+ characters)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.spoiler} onChange={(e) => setForm({ ...form, spoiler: e.target.checked })} />Contains spoilers</label>
        </div>
      </Modal>
    </div>
  );
}

const CATEGORIES = [['general', 'General'], ['characters', 'Characters'], ['arcs', 'Story arcs'], ['theories', 'Theories'], ['recommendations', 'Recommendations'], ['reviews', 'Reviews']] as const;
function Discussions({ title }: { title: Title }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [cat, setCat] = useState('');
  const q = useQuery({ queryKey: ['threads', title.id, cat], queryFn: () => api.get<any[]>(`/threads?titleId=${enc(title.id)}${cat ? `&category=${cat}` : ''}`) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', body: '', category: 'general', spoiler: false });
  const create = async () => {
    try { const t = await api.post('/threads', { ...form, titleId: title.id }); nav(`/threads/${t.id}`); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <p className="text-xs text-muted mb-3">Title-wide discussions. Chapter-specific talk lives in each chapter's comments.</p>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <button className={cat === '' ? 'chip-on' : 'chip'} onClick={() => setCat('')}>All</button>
        {CATEGORIES.map(([id, l]) => <button key={id} className={cat === id ? 'chip-on' : 'chip'} onClick={() => setCat(id)}>{l}</button>)}
        <div className="flex-1" />
        {user && <button className="btn-primary h-8" onClick={() => setOpen(true)}>New discussion</button>}
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-muted">No discussions yet.</p> : (
        <ul className="card divide-y divide-border/60">{q.data.map((t) => (
          <li key={t.id}><Link to={`/threads/${t.id}`} className="flex gap-3 p-3 hover:bg-hover/[0.04]">
            <Avatar user={t.user} size={32} />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{t.pinned && '📌 '}{t.subject}</div>
              <div className="text-xs text-muted">{CATEGORIES.find((c) => c[0] === t.category)?.[1]} · {t.user.displayName} · active {timeAgo(t.lastActivityAt)}{t.spoiler && ' · spoilers'}</div></div>
            <span className="text-xs text-muted inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{t.replyCount}</span>
          </Link></li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Start a discussion" footer={<button className="btn-primary" onClick={create}>Post</button>}>
        <div className="space-y-3">
          <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map(([value, label]) => ({ value, label }))} />
          <input className="input" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <textarea className="textarea" rows={6} placeholder="What's on your mind?" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.spoiler} onChange={(e) => setForm({ ...form, spoiler: e.target.checked })} />Contains spoilers</label>
        </div>
      </Modal>
    </div>
  );
}

function Readers({ title }: { title: Title }) {
  const q = useQuery({ queryKey: ['readers', title.id], queryFn: () => api.get<any[]>(`/titles/${enc(title.id)}/readers`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <p className="text-sm text-muted">No public readers yet.</p>;
  return <div className="flex flex-wrap gap-4">{q.data.map((u) => <Link key={u.id} to={`/u/${u.username}`} className="flex flex-col items-center gap-1 w-16 text-center"><Avatar user={u} size={48} /><span className="text-xs truncate w-full">{u.displayName}</span></Link>)}</div>;
}
