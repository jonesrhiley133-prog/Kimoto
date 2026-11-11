import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, CheckSquare, Grid3X3, Heart, LibraryBig, List as ListIcon, Rows3, Search, Star, Trash2 } from 'lucide-react';
import { api, enc, qs } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, cls, timeAgo } from '@/lib/format';
import type { Entry, Status, Title } from '@/lib/types';
import { Cover, Empty, ErrorState, Select, Spinner, Tabs, useDebounced } from '@/components/ui';
import { GridSkeleton, TitleCard, TitleGrid, titleHref } from '@/components/titles';
import { layoutFrom } from '@/lib/prefs';

interface Item { entry: Entry; title: Title; unread: number | null }
type View = 'grid' | 'list' | 'shelf';

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'reading';
  const { prefs, setPrefs } = useAuth();
  const view: View = prefs.libraryView ?? 'grid';
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('last_read');
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dq = useDebounced(search, 250);
  const qc = useQueryClient();
  const toast = useToast();
  const cardSize = layoutFrom(prefs).cardSize;

  const status = tab === 'favorites' || tab === 'all' || tab === 'annotations' ? undefined : tab;
  const q = useQuery({
    queryKey: ['library', tab, dq, tag, type, sort], enabled: tab !== 'annotations',
    queryFn: () => api.get<{ items: Item[]; counts: Record<string, number> }>(`/library${qs({ status, favorite: tab === 'favorites' ? 1 : undefined, q: dq, tag, type, sort })}`),
  });
  const meta = useQuery({ queryKey: ['library-meta'], queryFn: () => api.get<{ tags: string[]; shelves: string[] }>('/library/meta') });
  const counts = q.data?.counts;

  const bulk = async (patch?: Partial<Entry>, remove?: boolean) => {
    await api.post('/library/bulk', { titleIds: [...sel], patch, remove });
    toast(remove ? `Removed ${sel.size} titles` : `Updated ${sel.size} titles`, 'success');
    setSel(new Set()); setSelecting(false);
    qc.invalidateQueries({ queryKey: ['library'] });
  };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold">Library</h1>
        <div className="flex gap-2">
          <Link to="/lists" className="btn-outline"><ListIcon className="h-4 w-4" />Custom lists</Link>
        </div>
      </div>
      <Tabs value={tab} onChange={(v) => { setParams({ tab: v }); setSel(new Set()); }} className="mb-4" tabs={[
        ...STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABEL[s], count: counts?.[s] })),
        { id: 'favorites', label: 'Favorites', count: counts?.favorites }, { id: 'all', label: 'All', count: counts?.all }, { id: 'annotations', label: 'Bookmarks & notes' },
      ]} />

      {tab === 'annotations' ? <Annotations /> : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="relative flex-1 min-w-[180px] max-w-sm"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Filter your library" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select className="w-36" label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
            {!!meta.data?.tags.length && <Select className="w-36" label="Tag" value={tag} onChange={setTag} options={[{ value: '', label: 'All tags' }, ...meta.data.tags.map((t) => ({ value: t, label: `#${t}` }))]} />}
            <Select className="w-40" label="Sort" value={sort} onChange={setSort} options={[{ value: 'last_read', label: 'Last read' }, { value: 'updated', label: 'Recently updated' }, { value: 'added', label: 'Date added' }, { value: 'title', label: 'Title' }, { value: 'rating', label: 'Your rating' }, { value: 'progress', label: 'Progress' }, { value: 'unread', label: 'Unread chapters' }]} />
            <div className="flex-1" />
            <div className="inline-flex rounded border border-border p-0.5">
              {([['grid', Grid3X3, 'Grid'], ['list', Rows3, 'List'], ['shelf', LibraryBig, 'Bookshelf']] as const).map(([v, Icon, l]) => (
                <button key={v} onClick={() => setPrefs({ libraryView: v })} aria-label={`${l} view`} aria-pressed={view === v} className={cls('h-8 w-8 rounded-sm inline-flex items-center justify-center', view === v ? 'bg-primary text-on-primary' : 'text-muted hover:text-fg')}><Icon className="h-4 w-4" /></button>
              ))}
            </div>
            <button className={selecting ? 'btn-primary' : 'btn-outline'} onClick={() => { setSelecting(!selecting); setSel(new Set()); }}><CheckSquare className="h-4 w-4" />{selecting ? `${sel.size} selected` : 'Select'}</button>
          </div>
          {selecting && sel.size > 0 && (
            <div className="panel p-2 mb-4 flex flex-wrap items-center gap-2 sticky top-16 z-10">
              <span className="text-sm px-2">Move to:</span>
              {STATUS_ORDER.map((s) => <button key={s} className="btn-outline h-8" onClick={() => bulk({ status: s })}>{STATUS_LABEL[s]}</button>)}
              <button className="btn-danger h-8" onClick={() => confirm(`Remove ${sel.size} titles from your library?`) && bulk(undefined, true)}><Trash2 className="h-4 w-4" />Remove</button>
            </div>
          )}
          {q.isLoading ? <GridSkeleton /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data!.items.length ? (
            <Empty icon={<BookMarked />} title={search || tag || type ? 'Nothing matches these filters' : `No titles in ${tab === 'all' ? 'your library' : STATUS_LABEL[tab as Status] ?? 'Favorites'} yet`} action={<Link to="/discover" className="btn-primary">Discover titles</Link>} />
          ) : view === 'grid' ? (
            <TitleGrid size={cardSize}>{q.data!.items.map((i) => (
              <div key={i.title.id} className="relative" onClickCapture={(e) => { if (selecting) { e.preventDefault(); toggle(i.title.id); } }}>
                {selecting && <input type="checkbox" checked={sel.has(i.title.id)} readOnly className="absolute z-10 top-2 left-2 h-5 w-5" aria-label={`Select ${i.title.title}`} />}
                <TitleCard title={i.title} size={cardSize} subtitle={<Progress i={i} />} badge={i.unread ? <span className="rounded-full bg-accent text-white text-[11px] font-bold px-1.5 py-0.5">{i.unread}</span> : i.entry.favorite ? <Heart className="h-4 w-4 fill-accent text-accent drop-shadow" /> : undefined} />
              </div>
            ))}</TitleGrid>
          ) : view === 'list' ? (
            <ListView items={q.data!.items} selecting={selecting} sel={sel} toggle={toggle} />
          ) : (
            <Bookshelf items={q.data!.items} />
          )}
        </>
      )}
    </div>
  );
}

const Progress = ({ i }: { i: Item }) => (
  <span>Ch. {i.entry.progressChapter}{i.title.chapterCount ? ` / ${i.title.chapterCount}` : ''}{i.entry.rating ? ` · ★ ${i.entry.rating}` : ''}</span>
);

function ListView({ items, selecting, sel, toggle }: { items: Item[]; selecting: boolean; sel: Set<string>; toggle: (id: string) => void }) {
  return (
    <div className="card divide-y divide-border/60">
      {items.map((i) => {
        const pct = i.title.chapterCount ? Math.min(100, (i.entry.progressChapter / i.title.chapterCount) * 100) : null;
        return (
          <Link key={i.title.id} to={titleHref(i.title)} onClick={(e) => { if (selecting) { e.preventDefault(); toggle(i.title.id); } }} className="flex items-center gap-3 p-2.5 hover:bg-hover/[0.04]">
            {selecting && <input type="checkbox" checked={sel.has(i.title.id)} readOnly aria-label={`Select ${i.title.title}`} />}
            <Cover src={i.title.coverUrl} alt={i.title.title} className="w-10 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{i.entry.favorite && <Heart className="inline h-3.5 w-3.5 fill-accent text-accent mr-1 -mt-0.5" />}{i.title.title}</div>
              <div className="text-xs text-muted truncate">{TYPE_LABEL[i.title.type]} · {STATUS_LABEL[i.entry.status]}{i.entry.lastReadAt && ` · read ${timeAgo(i.entry.lastReadAt)}`}{i.entry.tags.length ? ` · ${i.entry.tags.map((t) => `#${t}`).join(' ')}` : ''}</div>
              {pct != null && <div className="h-1 mt-1.5 rounded-full bg-border overflow-hidden max-w-xs"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>}
            </div>
            <div className="text-right text-xs shrink-0 hidden sm:block">
              <div className="tabular-nums">Ch. {i.entry.progressChapter}{i.title.chapterCount ? `/${i.title.chapterCount}` : ''}</div>
              {i.entry.rating && <div className="text-muted inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-warning text-warning" />{i.entry.rating}</div>}
            </div>
            {i.unread ? <span className="rounded-full bg-accent text-white text-[11px] font-bold px-1.5 py-0.5">{i.unread}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Visual bookshelves grouped by the user's custom shelf names. */
function Bookshelf({ items }: { items: Item[] }) {
  const shelves = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) { const k = i.entry.shelf || 'Unshelved'; m.set(k, [...(m.get(k) ?? []), i]); }
    return [...m.entries()].sort((a, b) => (a[0] === 'Unshelved' ? 1 : b[0] === 'Unshelved' ? -1 : a[0].localeCompare(b[0])));
  }, [items]);
  return (
    <div className="space-y-10">
      {shelves.map(([name, list]) => (
        <section key={name}>
          <h2 className="h-section mb-2">{name} <span className="text-sm text-muted font-normal">{list.length}</span></h2>
          <div className="relative">
            <div className="flex gap-2 sm:gap-3 overflow-x-auto no-scrollbar px-3 pt-4 items-end">
              {list.map((i) => (
                <Link key={i.title.id} to={titleHref(i.title)} title={i.title.title} className="shrink-0 w-20 sm:w-24 origin-bottom transition-transform hover:-translate-y-2 hover:rotate-[-2deg]">
                  <Cover src={i.title.coverUrl} alt={i.title.title} rounded={false} className="rounded-sm shadow-[4px_4px_10px_rgba(0,0,0,.45)]" />
                </Link>
              ))}
            </div>
            <div className="h-3 rounded-sm bg-gradient-to-b from-[#7a5230] to-[#4a2f18] shadow-[0_6px_12px_rgba(0,0,0,.4)]" />
          </div>
        </section>
      ))}
      <p className="text-xs text-muted">Put titles on shelves from <em>Edit details</em> in the library menu on any title page.</p>
    </div>
  );
}

function Annotations() {
  const q = useQuery({ queryKey: ['annotations', 'all'], queryFn: () => api.get<any[]>('/reading/annotations') });
  const [kind, setKind] = useState('');
  if (q.isLoading) return <Spinner />;
  const list = (q.data ?? []).filter((a) => !kind || a.kind === kind);
  return (
    <div>
      <div className="flex gap-1.5 mb-4">{[['', 'All'], ['bookmark', 'Bookmarks'], ['note', 'Notes'], ['panel', 'Favorite panels'], ['quote', 'Quotes']].map(([v, l]) => <button key={v} className={kind === v ? 'chip-on' : 'chip'} onClick={() => setKind(v)}>{l}</button>)}</div>
      {!list.length ? <Empty icon={<BookMarked />} title="No saved moments yet">Bookmark pages, save favorite panels, write notes and save quotes from the reader.</Empty> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{list.map((a) => (
          <Link key={a.id} to={`/read/${enc(a.chapterId)}`} className="card p-3 hover:border-primary/50 block">
            <div className="flex items-center gap-2 text-xs"><span className="uppercase tracking-wide text-primary">{a.kind}</span><span className="text-muted truncate">{a.titleName} · Ch. {a.chapterLabel ?? '?'}{a.kind !== 'quote' && ` · p. ${a.page + 1}`}</span></div>
            {a.quote && <blockquote className="mt-2 border-l-2 border-primary pl-2 italic text-sm line-clamp-4">{a.quote}</blockquote>}
            {a.note && <p className="mt-2 text-sm line-clamp-3">{a.note}</p>}
            <div className="text-xs text-muted mt-2">{timeAgo(a.createdAt)}</div>
          </Link>
        ))}</div>
      )}
    </div>
  );
}
