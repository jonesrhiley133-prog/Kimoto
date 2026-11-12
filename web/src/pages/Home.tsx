import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, LayoutGrid, Maximize2, Minimize2, Play, Save, Flame, Clock, BookOpen } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { chapterLabel, cls, duration, timeAgo } from '@/lib/format';
import { layoutFrom, WIDGETS, type LayoutData, type WidgetConf, type WidgetId } from '@/lib/prefs';
import type { Activity, Entry, ListDTO, Title } from '@/lib/types';
import { Cover, ErrorState, Menu, MenuItem, Modal, Spinner } from '@/components/ui';
import { GridSkeleton, TitleCard, TitleRow, titleHref } from '@/components/titles';
import { ActivityItem } from '@/components/feed';

export default function Home() {
  const { user, prefs, setPrefs } = useAuth();
  const layout = layoutFrom(prefs);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const update = (widgets: WidgetConf[]) => setPrefs({ layout: { widgets } });
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.widgets.findIndex((w) => w.id === e.active.id);
    const to = layout.widgets.findIndex((w) => w.id === e.over!.id);
    update(arrayMove(layout.widgets, from, to));
  };
  const visible = editing ? layout.widgets : layout.widgets.filter((w) => !w.hidden);
  const hour = new Date().getHours();

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <p className="text-sm text-muted">{hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'},</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{user?.displayName}</h1>
        </div>
        <div className="flex gap-2">
          {editing && <LayoutsMenu layout={layout} />}
          <button className={editing ? 'btn-primary' : 'btn-outline'} onClick={() => setEditing(!editing)}><LayoutGrid className="h-4 w-4" />{editing ? 'Done' : 'Customize'}</button>
        </div>
      </div>
      {editing && <p className="text-sm text-muted mb-4 -mt-2">Drag widgets to reorder. Use the controls to resize or hide them.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy} disabled={!editing}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-8">
            {visible.map((w) => (
              <WidgetFrame key={w.id} w={w} editing={editing}
                onToggle={() => update(layout.widgets.map((x) => (x.id === w.id ? { ...x, hidden: !x.hidden } : x)))}
                onResize={() => update(layout.widgets.map((x) => (x.id === w.id ? { ...x, size: x.size === 'full' ? 'half' : 'full' } : x)))}>
                <Widget id={w.id} />
              </WidgetFrame>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function WidgetFrame({ w, editing, children, onToggle, onResize }: { w: WidgetConf; editing: boolean; children: ReactNode; onToggle: () => void; onResize: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cls('min-w-0', w.size === 'full' && 'lg:col-span-2', editing && 'rounded-lg border border-dashed border-border p-3', isDragging && 'z-10 opacity-80', w.hidden && 'opacity-40')}>
      {editing && (
        <div className="flex items-center gap-1 mb-2 -mt-1">
          <button className="btn-icon cursor-grab active:cursor-grabbing" {...attributes} {...listeners} aria-label={`Move ${WIDGETS[w.id]}`}><GripVertical className="h-4 w-4" /></button>
          <span className="text-sm font-medium flex-1">{WIDGETS[w.id]}</span>
          <button className="btn-icon hidden lg:inline-flex" onClick={onResize} aria-label={w.size === 'full' ? 'Make half width' : 'Make full width'}>{w.size === 'full' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
          <button className="btn-icon" onClick={onToggle} aria-label={w.hidden ? 'Show widget' : 'Hide widget'}>{w.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
      )}
      {(!editing || !w.hidden) && children}
    </div>
  );
}

function LayoutsMenu({ layout }: { layout: LayoutData }) {
  const { setPrefs } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const saved = useQuery({ queryKey: ['layouts'], queryFn: () => api.get<{ id: string; name: string; data: LayoutData; active: boolean }[]>('/settings/layouts') });
  return (
    <>
      <Menu trigger={() => <button className="btn-outline"><Save className="h-4 w-4" />Layouts</button>}>
        {(close) => (
          <>
            {saved.data?.map((l) => <MenuItem key={l.id} active={l.active} onClick={() => { setPrefs({ layout: l.data }); api.put(`/settings/layouts/${l.id}`, { active: true }).then(() => saved.refetch()); close(); }}>{l.name}</MenuItem>)}
            {saved.data?.length ? <div className="my-1 border-t border-border" /> : null}
            <MenuItem onClick={() => { setOpen(true); close(); }}>Save current layout…</MenuItem>
            <MenuItem onClick={() => { setPrefs({ layout: { widgets: [] } }); close(); }}>Reset to default</MenuItem>
          </>
        )}
      </Menu>
      <Modal open={open} onClose={() => setOpen(false)} title="Save layout" footer={<button className="btn-primary" onClick={async () => { await api.post('/settings/layouts', { name: name || 'My layout', data: layout }); saved.refetch(); setOpen(false); toast('Layout saved', 'success'); }}>Save</button>}>
        <input className="input" autoFocus placeholder="e.g. Commute, Weekend binge" value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </>
  );
}

function Header({ title, to, extra }: { title: string; to?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="h-section">{title}</h2>
      <div className="flex items-center gap-3">{extra}{to && <Link to={to} className="text-sm text-muted hover:text-fg">See all</Link>}</div>
    </div>
  );
}

function Widget({ id }: { id: WidgetId }) {
  switch (id) {
    case 'continue': return <ContinueWidget />;
    case 'updates': return <UpdatesWidget />;
    case 'recommended': return <RecommendedWidget />;
    case 'trending': return <DiscoverWidget section="trending" title="Trending" />;
    case 'latest': return <DiscoverWidget section="latest" title="Latest releases" />;
    case 'novels': return <DiscoverWidget section="novels" title="Popular light novels" />;
    case 'stats': return <StatsWidget />;
    case 'feed': return <FeedWidget />;
    case 'lists': return <ListsWidget />;
    case 'history': return <HistoryWidget />;
  }
}

interface ContinueItem { title: Title; readAt: string; resume: { chapterId: string; page: number; chapter: any }; progress: number }
function ContinueWidget() {
  const q = useQuery({ queryKey: ['continue'], queryFn: () => api.get<ContinueItem[]>('/reading/continue?limit=12') });
  return (
    <section>
      <Header title="Continue reading" to="/library" />
      {q.isLoading ? <GridSkeleton n={6} row /> : q.error ? <ErrorState compact error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <div className="card p-6 text-sm text-muted">Nothing in progress yet. <Link to="/discover" className="link">Find something to read →</Link></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 snap-x">
          {q.data.map((c) => (
            <Link key={c.title.id} to={`/read/${enc(c.resume.chapterId)}`} className="snap-start shrink-0 w-[260px] card p-2.5 flex gap-3 hover:border-primary/50 transition-colors group">
              <Cover src={c.title.coverUrl} alt={c.title.title} className="w-14 shrink-0" />
              <div className="min-w-0 flex-1 flex flex-col">
                <div className="text-sm font-medium line-clamp-2 leading-snug">{c.title.title}</div>
                <div className="text-xs text-muted mt-1 truncate">{chapterLabel(c.resume.chapter, false)}{c.resume.page ? ` · p. ${c.resume.page + 1}` : ''}</div>
                <div className="mt-auto flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round((c.progress || 0) * 100)}%` }} /></div>
                  <Play className="h-4 w-4 text-primary opacity-70 group-hover:opacity-100" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function UpdatesWidget() {
  const q = useQuery({ queryKey: ['library', 'updates'], queryFn: () => api.get<{ items: { title: Title; entry: Entry; unread: number | null }[] }>('/library?status=reading&sort=last_read') });
  const items = (q.data?.items ?? []).filter((i) => (i.unread ?? 0) > 0).slice(0, 14);
  return (
    <section>
      <Header title="Library updates" to="/library" />
      {q.isLoading ? <GridSkeleton n={6} row /> : !items.length ? <div className="card p-6 text-sm text-muted">You're all caught up on the titles you're reading.</div> : (
        <TitleRow>{items.map((i) => <TitleCard key={i.title.id} title={i.title} subtitle={`Ch. ${i.entry.progressChapter} read`} badge={<span className="rounded-full bg-accent text-white text-[11px] font-bold px-1.5 py-0.5">{i.unread}</span>} />)}</TitleRow>
      )}
    </section>
  );
}

function RecommendedWidget() {
  const q = useQuery({ queryKey: ['recommendations'], queryFn: () => api.get<{ items: Title[]; reasons: Record<string, string>; basedOn: string[] }>('/recommendations?limit=18'), staleTime: 10 * 60_000 });
  return (
    <section>
      <Header title="Recommended for you" extra={q.data?.basedOn?.length ? <span className="hidden sm:inline text-xs text-muted">Based on {q.data.basedOn.join(', ')}</span> : null} />
      {q.isLoading ? <GridSkeleton n={6} row /> : q.error ? <ErrorState compact error={q.error} retry={q.refetch} /> : !q.data?.items.length ? (
        <div className="card p-6 text-sm text-muted">Add a few titles to your library or rate what you've read, and recommendations will appear here.</div>
      ) : <TitleRow>{q.data.items.map((t) => <TitleCard key={t.id} title={t} subtitle={q.data.reasons[t.id]} />)}</TitleRow>}
    </section>
  );
}

export function DiscoverWidget({ section, title }: { section: string; title: string }) {
  const q = useQuery({ queryKey: ['discover', section, 'row'], queryFn: () => api.get<{ items: Title[]; source: string | null }>(`/discover/${section}?limit=18`), staleTime: 10 * 60_000 });
  return (
    <section>
      <Header title={title} to={`/discover?section=${section}`} extra={q.data?.source && <span className="text-xs text-muted">via {q.data.source}</span>} />
      {q.isLoading ? <GridSkeleton n={6} row /> : q.error ? <ErrorState compact error={q.error} retry={q.refetch} /> : !q.data?.items.length ? <div className="card p-6 text-sm text-muted">No sources with this section are enabled.</div>
        : <TitleRow>{q.data.items.map((t) => <TitleCard key={t.id} title={t} />)}</TitleRow>}
    </section>
  );
}

function StatsWidget() {
  const q = useQuery({ queryKey: ['stats', '7d'], queryFn: () => api.get(`/stats?range=7d&tz=${enc(Intl.DateTimeFormat().resolvedOptions().timeZone)}`) });
  const d = q.data;
  return (
    <section>
      <Header title="This week" to="/stats" />
      <div className="card p-4">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState compact error={q.error} /> : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Mini icon={<Clock />} label="Reading time" value={duration(d.totals.totalSeconds)} />
              <Mini icon={<BookOpen />} label="Chapters" value={d.totals.chaptersRead} />
              <Mini icon={<Flame />} label="Streak" value={`${d.totals.currentStreak}d`} />
            </div>
            <div className="h-28" role="img" aria-label="Minutes read per day this week">
              <ResponsiveContainer>
                <BarChart data={d.daily.map((x: any) => ({ ...x, minutes: Math.round(x.seconds / 60), day: new Date(`${x.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }) }))} barCategoryGap={6}>
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--c-muted))' }} />
                  <Tooltip cursor={{ fill: 'rgb(var(--c-hover) / 0.05)' }} contentStyle={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v} min`, 'Read']} />
                  <Bar dataKey="minutes" fill="rgb(var(--c-primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
const Mini = ({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) => (
  <div><div className="flex items-center gap-1.5 text-xs text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}{label}</div><div className="font-display text-xl font-semibold mt-0.5 tabular-nums">{value}</div></div>
);

function FeedWidget() {
  const q = useQuery({ queryKey: ['feed', 'following'], queryFn: () => api.get<Activity[]>('/feed?limit=8') });
  return (
    <section>
      <Header title="Friends activity" to="/community/feed" />
      <div className="card px-4 py-1">
        {q.isLoading ? <div className="py-4"><Spinner /></div> : !q.data?.length ? <p className="text-sm text-muted py-4">Follow people to see what they're reading. <Link to="/community/rankings" className="link">Find readers →</Link></p>
          : <ul className="divide-y divide-border/60">{q.data.map((a) => <ActivityItem key={a.id} a={a} />)}</ul>}
      </div>
    </section>
  );
}

function ListsWidget() {
  const q = useQuery({ queryKey: ['lists', 'mine'], queryFn: () => api.get<ListDTO[]>('/lists/mine') });
  return (
    <section>
      <Header title="Your lists" to="/lists" />
      <div className="card p-2">
        {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-muted p-3">No lists yet. <Link to="/lists" className="link">Create one →</Link></p> : (
          <ul>{q.data.slice(0, 6).map((l) => (
            <li key={l.id}><Link to={`/lists/${l.id}`} className="flex items-center gap-3 p-2 rounded hover:bg-hover/[0.05]">
              <div className="flex -space-x-3">{l.previews.slice(0, 3).map((p, i) => <img key={i} src={p ?? '/icon.svg'} alt="" className="h-10 w-7 rounded-sm object-cover ring-2 ring-card" />)}{!l.previews.length && <div className="h-10 w-7 rounded-sm bg-surface-2" />}</div>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{l.name}</div><div className="text-xs text-muted">{l.itemCount} titles · {l.visibility}</div></div>
            </Link></li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}

function HistoryWidget() {
  const q = useQuery({ queryKey: ['history', 'widget'], queryFn: () => api.get<any[]>('/reading/history?limit=8') });
  return (
    <section>
      <Header title="Recently read" to="/stats?tab=history" />
      <div className="card p-2">
        {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-muted p-3">Your reading history will show up here.</p> : (
          <ul>{q.data.map((h) => (
            <li key={h.chapterId}><Link to={`/read/${enc(h.chapterId)}`} className="flex items-center gap-3 p-2 rounded hover:bg-hover/[0.05]">
              <img src={h.title.coverUrl ?? '/icon.svg'} alt="" className="h-10 w-7 rounded-sm object-cover" loading="lazy" />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{h.title.title}</div><div className="text-xs text-muted truncate">{chapterLabel(h.chapter)} · {timeAgo(h.readAt)}</div></div>
            </Link></li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}
