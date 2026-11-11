import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, CalendarDays, Clock, Flame, Gift, Hourglass, Sparkles, Timer, Trash2, Trophy } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { chapterLabel, duration, TYPE_LABEL, timeAgo, tz } from '@/lib/format';
import { ErrorState, PageLoader, Segmented, Spinner, Tabs, Toggle } from '@/components/ui';
import { Stat } from '@/components/titles';
import { ChartCard, Heatmap, Legend, axis, tooltipStyle, useChartColors } from '@/components/charts';

const RANGES = [{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '6m', label: '6 months' }, { value: '1y', label: '1 year' }, { value: 'all', label: 'All time' }] as const;
type Range = (typeof RANGES)[number]['value'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
const mins = (s: number) => Math.round(s / 60);

export default function Stats() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const [range, setRange] = useState<Range>('30d');
  const user = params.get('user') ?? undefined;
  const q = useQuery({ queryKey: ['stats', range, user], queryFn: () => api.get<any>(`/stats?range=${range}&tz=${enc(tz())}${user ? `&user=${enc(user)}` : ''}`) });
  const year = useQuery({ queryKey: ['stats', '1y', user], queryFn: () => api.get<any>(`/stats?range=1y&tz=${enc(tz())}${user ? `&user=${enc(user)}` : ''}`), enabled: tab === 'overview' });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold">{user ? `${user}'s statistics` : 'Reading statistics'}</h1>
        <div className="flex flex-wrap gap-2 items-center">
          {!user && <Link to="/stats/wrapped" className="btn-outline"><Gift className="h-4 w-4" />{new Date().getFullYear()} Wrapped</Link>}
          <Segmented size="sm" value={range} onChange={setRange} options={RANGES as any} />
        </div>
      </div>
      <Tabs value={tab} onChange={(v) => setParams({ tab: v, ...(user ? { user } : {}) })} className="mb-5" tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'genres', label: 'Genres' }, { id: 'time', label: 'Time' }, { id: 'habits', label: 'Habits' },
        ...(user ? [] : [{ id: 'history', label: 'History' }]),
      ]} />
      {tab === 'history' ? <History /> : q.isLoading ? <PageLoader /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <>
          {tab === 'overview' && <Overview s={q.data} year={year.data} />}
          {tab === 'genres' && <Genres s={q.data} />}
          {tab === 'time' && <Time s={q.data} />}
          {tab === 'habits' && <Habits s={q.data} />}
          {q.data.totals.sessions === 0 && q.data.totals.chaptersRead === 0 && (
            <p className="text-sm text-muted text-center py-8">No reading recorded in this period. Statistics come only from your actual reading in Kimoto's reader.</p>
          )}
        </>
      )}
    </div>
  );
}

function Overview({ s, year }: { s: any; year?: any }) {
  const c = useChartColors();
  const t = s.totals;
  const daily = s.daily.map((d: any) => ({ ...d, minutes: mins(d.seconds), label: new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Reading time" value={duration(t.totalSeconds)} sub={`${duration(t.avgDailySeconds)} / day avg`} />
        <Stat label="Chapters read" value={t.chaptersRead.toLocaleString()} sub={`${t.titlesRead} titles`} />
        <Stat label="Completed" value={t.mangaCompleted + t.novelsCompleted} sub={`${t.mangaCompleted} manga · ${t.novelsCompleted} novels`} />
        <Stat label="Sessions" value={t.sessions} sub={`${duration(t.avgSessionSeconds)} average`} />
        <Stat label="Current streak" value={`${t.currentStreak} day${t.currentStreak === 1 ? '' : 's'}`} sub={`Longest ${t.longestStreak} days`} />
        <Stat label="Volumes" value={t.volumesCompleted} sub={`${t.novelChaptersRead} novel chapters`} />
      </div>
      <ChartCard title="Daily reading time" subtitle="Minutes of active reading per day">
        <div className="h-56" role="img" aria-label="Area chart of minutes read per day">
          <ResponsiveContainer>
            <AreaChart data={daily} margin={{ left: -18, right: 8, top: 6 }}>
              <defs><linearGradient id="fillMin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.primary} stopOpacity={0.35} /><stop offset="1" stopColor={c.primary} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.5} />
              <XAxis dataKey="label" {...axis(c)} minTickGap={24} />
              <YAxis {...axis(c)} width={44} />
              <Tooltip {...tooltipStyle(c)} formatter={(v: number, _n, p: any) => [`${v} min · ${p.payload.chapters} ch.`, 'Read']} />
              <Area type="monotone" dataKey="minutes" stroke={c.primary} strokeWidth={2} fill="url(#fillMin)" activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      {year && <ChartCard title="Activity calendar" subtitle="The past year — darker means more reading"><Heatmap days={year.daily} /></ChartCard>}
      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Monthly comparison" subtitle="Chapters completed per month">
          {s.monthly.length ? (
            <div className="h-56"><ResponsiveContainer>
              <BarChart data={s.monthly.map((m: any) => ({ ...m, label: new Date(`${m.month}-15`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }))} margin={{ left: -18, right: 8 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.5} />
                <XAxis dataKey="label" {...axis(c)} /><YAxis {...axis(c)} allowDecimals={false} width={44} />
                <Tooltip {...tooltipStyle(c)} formatter={(v: number, _n, p: any) => [`${v} chapters · ${duration(p.payload.seconds)} · ${p.payload.titles} titles`, '']} />
                <Bar dataKey="chapters" fill={c.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          ) : <p className="text-sm text-muted">No data yet.</p>}
        </ChartCard>
        <ChartCard title="Most read" subtitle="By reading time in this period">
          {!s.topTitles.length ? <p className="text-sm text-muted">No data yet.</p> : (
            <ol className="space-y-2">{s.topTitles.slice(0, 6).map((x: any, i: number) => {
              const max = s.topTitles[0].seconds || 1;
              return (
                <li key={x.titleId} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-muted tabular-nums">{i + 1}</span>
                  {x.coverUrl ? <img src={x.coverUrl} alt="" className="h-9 w-6 rounded-sm object-cover" /> : <span className="h-9 w-6 rounded-sm bg-surface-2" />}
                  <div className="flex-1 min-w-0"><Link to={`/title/${enc(x.titleId)}`} className="truncate block hover:text-primary">{x.title}</Link>
                    <div className="h-1 mt-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-primary" style={{ width: `${(x.seconds / max) * 100}%` }} /></div></div>
                  <span className="text-xs text-muted tabular-nums text-right w-20">{duration(x.seconds)}<br />{x.chapters} ch.</span>
                </li>
              );
            })}</ol>
          )}
        </ChartCard>
      </div>
      {s.yearly.length > 1 && (
        <ChartCard title="Yearly summary">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{s.yearly.map((y: any) => <Stat key={y.year} label={String(y.year)} value={`${y.chapters} ch.`} sub={duration(y.seconds)} />)}</div>
        </ChartCard>
      )}
    </div>
  );
}

function Genres({ s }: { s: any }) {
  const c = useChartColors();
  const [metric, setMetric] = useState<'seconds' | 'chapters'>('seconds');
  // Fixed-order categorical slots for the top 7 genres; the rest fold into "Other".
  const top = s.genres.slice(0, 7);
  const rest = s.genres.slice(7);
  const pie = [...top.map((g: any, i: number) => ({ name: g.genre, value: g[metric], color: c.series[i] })),
    ...(rest.length ? [{ name: 'Other', value: rest.reduce((n: number, g: any) => n + g[metric], 0), color: c.muted }] : [])].filter((x) => x.value > 0);
  const total = pie.reduce((n, x) => n + x.value, 0) || 1;
  const colorOf = (g: string) => c.series[s.topGenres.indexOf(g)] ?? c.muted;
  return (
    <div className="space-y-5">
      {!s.genres.length ? <p className="text-sm text-muted">Genre analytics appear once you've read some chapters.</p> : (
        <>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5">
            <ChartCard title="Genre distribution" subtitle={metric === 'seconds' ? 'Share of reading time' : 'Share of chapters read'} action={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'seconds', label: 'Time' }, { value: 'chapters', label: 'Chapters' }]} />}>
              <div className="h-56" role="img" aria-label="Donut chart of genre share">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1.5} stroke={c.surface} strokeWidth={2}>
                      {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle(c)} formatter={(v: number, n: string) => [`${metric === 'seconds' ? duration(v) : `${v} ch.`} · ${Math.round((v / total) * 100)}%`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <Legend items={pie.map((p) => ({ label: p.name, color: p.color, value: `${Math.round((p.value / total) * 100)}%` }))} />
            </ChartCard>
            <ChartCard title="Most-read genres" subtitle="Chapters completed per genre">
              <div style={{ height: Math.max(180, Math.min(14, s.genres.length) * 26) }}>
                <ResponsiveContainer>
                  <BarChart data={s.genres.slice(0, 14)} layout="vertical" margin={{ left: 0, right: 16 }} barCategoryGap={4}>
                    <XAxis type="number" {...axis(c)} allowDecimals={false} />
                    <YAxis type="category" dataKey="genre" {...axis(c)} width={110} />
                    <Tooltip {...tooltipStyle(c)} formatter={(v: number, _n, p: any) => [`${v} chapters · ${duration(p.payload.seconds)}`, '']} />
                    <Bar dataKey="chapters" fill={c.primary} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
          {s.genreTrend.length > 1 && (
            <ChartCard title="Genre trends over time" subtitle="Chapters per month for your top genres">
              <div className="h-64"><ResponsiveContainer>
                <LineChart data={s.genreTrend.map((m: any) => ({ ...m, label: new Date(`${m.month}-15`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }))} margin={{ left: -18, right: 8, top: 6 }}>
                  <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.5} />
                  <XAxis dataKey="label" {...axis(c)} /><YAxis {...axis(c)} allowDecimals={false} width={44} />
                  <Tooltip {...tooltipStyle(c)} />
                  {s.topGenres.map((g: string) => <Line key={g} type="monotone" dataKey={g} stroke={colorOf(g)} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: c.surface }} activeDot={{ r: 5 }} />)}
                </LineChart>
              </ResponsiveContainer></div>
              <Legend items={s.topGenres.map((g: string) => ({ label: g, color: colorOf(g) }))} />
            </ChartCard>
          )}
          {s.types.length > 0 && (
            <ChartCard title="By content type" subtitle="Reading time">
              <div className="space-y-2">{s.types.map((x: any) => {
                const max = s.types[0].seconds || 1;
                return <div key={x.type} className="flex items-center gap-3 text-sm"><span className="w-28 text-muted">{TYPE_LABEL[x.type as keyof typeof TYPE_LABEL] ?? x.type}</span><div className="flex-1 h-2 rounded-full bg-border overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${(x.seconds / max) * 100}%` }} /></div><span className="w-20 text-right tabular-nums text-muted">{duration(x.seconds)}</span></div>;
              })}</div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}

function Time({ s }: { s: any }) {
  const c = useChartColors();
  const hours = s.byHour.map((h: any) => ({ ...h, minutes: mins(h.seconds), label: hourLabel(h.hour) }));
  const peak = [...s.byHour].sort((a: any, b: any) => b.seconds - a.seconds)[0];
  const parts = [['morning', 'Morning', '5am–12pm'], ['afternoon', 'Afternoon', '12–5pm'], ['evening', 'Evening', '5–9pm'], ['night', 'Night', '9pm–5am']] as const;
  const partTotal = Object.values(s.dayParts as Record<string, number>).reduce((a, b) => a + b, 0) || 1;
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ ...s.byWeekday[d], label: DAYS[d], minutes: mins(s.byWeekday[d].seconds) }));
  const topDay = [...weekdays].sort((a, b) => b.seconds - a.seconds)[0];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {parts.map(([k, l, r]) => <Stat key={k} label={`${l} · ${r}`} value={`${Math.round((s.dayParts[k] / partTotal) * 100)}%`} sub={duration(s.dayParts[k])} />)}
      </div>
      <ChartCard title="Reading by hour of day" subtitle={peak?.seconds ? `Most active around ${hourLabel(peak.hour)}` : 'Your local time'}>
        <div className="h-56"><ResponsiveContainer>
          <BarChart data={hours} margin={{ left: -18, right: 8 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.5} />
            <XAxis dataKey="label" {...axis(c)} interval={2} /><YAxis {...axis(c)} width={44} />
            <Tooltip {...tooltipStyle(c)} formatter={(v: number, _n, p: any) => [`${v} min · ${p.payload.chapters} ch.`, 'Read']} />
            <Bar dataKey="minutes" fill={c.primary} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer></div>
      </ChartCard>
      <ChartCard title="Weekly pattern" subtitle={topDay?.seconds ? `${topDay.label} is your biggest reading day` : 'Minutes by weekday'}>
        <div className="h-48"><ResponsiveContainer>
          <BarChart data={weekdays} margin={{ left: -18, right: 8 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.5} />
            <XAxis dataKey="label" {...axis(c)} /><YAxis {...axis(c)} width={44} />
            <Tooltip {...tooltipStyle(c)} formatter={(v: number, _n, p: any) => [`${v} min · ${p.payload.chapters} ch.`, 'Read']} />
            <Bar dataKey="minutes" fill={c.primary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer></div>
      </ChartCard>
      <ChartCard title="Recent sessions" subtitle="Activity timeline">
        {!s.timeline.length ? <p className="text-sm text-muted">No sessions in this period.</p> : (
          <ol className="relative border-l border-border ml-2 space-y-3">{s.timeline.slice(0, 15).map((x: any) => (
            <li key={x.id} className="ml-4 text-sm">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
              <Link to={`/title/${enc(x.titleId)}`} className="font-medium hover:text-primary">{x.title ?? 'Unknown title'}</Link>
              <div className="text-xs text-muted">{new Date(x.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {duration(x.seconds)} · {x.chapters} ch. · {x.pages} pages</div>
            </li>
          ))}</ol>
        )}
      </ChartCard>
    </div>
  );
}

function Habits({ s }: { s: any }) {
  const h = s.habits, t = s.totals;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Chapters per session" value={h.avgChaptersPerSession} />
        <Stat label="Chapters per day" value={h.avgChaptersPerDay} sub={`${h.avgChaptersPerActiveDay} on days you read`} />
        <Stat label="Reading frequency" value={`${Math.round(h.readingFrequency * 100)}%`} sub={`${t.activeDays} active days`} />
        <Stat label="Completion rate" value={h.completionRate == null ? '—' : `${Math.round(h.completionRate * 100)}%`} sub="completed vs dropped" />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Highlight icon={<Timer />} label="Longest session" value={t.longestSession ? duration(t.longestSession.seconds) : '—'} sub={t.longestSession ? `${t.longestSession.title} · ${new Date(t.longestSession.at).toLocaleDateString()}` : ''} />
        <Highlight icon={<Flame />} label="Streaks" value={`${t.currentStreak} / ${t.longestStreak} days`} sub="current / longest" />
        <Highlight icon={<CalendarDays />} label="Most active day" value={t.mostActiveDay ? new Date(`${t.mostActiveDay.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} sub={t.mostActiveDay ? `${duration(t.mostActiveDay.seconds)} · ${t.mostActiveDay.chapters} ch.` : ''} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Most revisited" subtitle="Titles you've re-read chapters of">
          {!h.mostRevisited.length ? <p className="text-sm text-muted">No re-reads yet.</p> : <TitleList items={h.mostRevisited.map((x: any) => ({ ...x, meta: `${x.rereads} re-read chapters` }))} />}
        </ChartCard>
        <ChartCard title="Most often abandoned" subtitle="Dropped titles, by how far you got">
          {!h.mostAbandoned.length ? <p className="text-sm text-muted">Nothing dropped — nice.</p> : <TitleList items={h.mostAbandoned.map((x: any) => ({ ...x, meta: `Dropped at ch. ${x.progressChapter} · ${timeAgo(x.droppedAt)}` }))} />}
        </ChartCard>
      </div>
      <ChartCard title="Library breakdown">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">{Object.entries(s.library).map(([k, v]) => <div key={k}><div className="font-display text-xl font-semibold">{v as number}</div><div className="text-xs text-muted capitalize">{k.replace('_', ' ')}</div></div>)}</div>
      </ChartCard>
    </div>
  );
}
const Highlight = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) => (
  <div className="card p-4 flex gap-3"><div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
    <div className="min-w-0"><div className="text-xs text-muted">{label}</div><div className="font-display font-semibold text-lg">{value}</div><div className="text-xs text-muted truncate">{sub}</div></div></div>
);
const TitleList = ({ items }: { items: any[] }) => (
  <ul className="space-y-2">{items.map((x) => (
    <li key={x.titleId} className="flex items-center gap-3 text-sm"><Link to={`/title/${enc(x.titleId)}`} className="flex-1 truncate hover:text-primary">{x.title}</Link><span className="text-xs text-muted">{x.meta}</span></li>
  ))}</ul>
);

function History() {
  const { prefs, setPrefs } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['history', 'page'], initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<any[]>(`/reading/history?limit=40&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.length === 40 ? pages.length * 40 : undefined),
  });
  const items = q.data?.pages.flat() ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const h of items) { const k = new Date(h.readAt).toDateString(); m.set(k, [...(m.get(k) ?? []), h]); }
    return [...m.entries()];
  }, [items]);
  const clear = async (analytics: boolean) => {
    if (!confirm(analytics ? 'Delete ALL reading history and statistics? This cannot be undone.' : 'Clear your reading history (progress markers)? Statistics are kept.')) return;
    await api.del('/reading/history', { analytics });
    qc.invalidateQueries();
    toast('History cleared', 'success');
  };
  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-6">
      <div>
        {q.isLoading ? <Spinner /> : !items.length ? <p className="text-sm text-muted">No reading history.</p> : groups.map(([day, list]) => (
          <section key={day} className="mb-5">
            <h3 className="text-xs font-medium text-muted mb-2">{day}</h3>
            <ul className="card divide-y divide-border/60">{list.map((h) => (
              <li key={h.chapterId} className="flex items-center gap-3 p-2.5">
                <img src={h.title.coverUrl ?? '/icon.svg'} alt="" className="h-11 w-8 rounded-sm object-cover" loading="lazy" />
                <Link to={`/read/${enc(h.chapterId)}`} className="flex-1 min-w-0"><div className="text-sm font-medium truncate hover:text-primary">{h.title.title}</div>
                  <div className="text-xs text-muted truncate">{chapterLabel(h.chapter)} · {h.completed ? 'finished' : h.totalPages ? `page ${h.page + 1}/${h.totalPages}` : 'in progress'} · {new Date(h.readAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div></Link>
                <button className="btn-icon h-8 w-8" aria-label="Remove from history" onClick={() => api.del('/reading/history', { chapterId: h.chapterId }).then(() => q.refetch())}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}</ul>
          </section>
        ))}
        {q.hasNextPage && <button className="btn-outline" onClick={() => q.fetchNextPage()}>Load more</button>}
      </div>
      <aside className="space-y-3">
        <div className="card p-4 space-y-2">
          <h3 className="font-medium text-sm">Your data, your control</h3>
          <Toggle label="Record reading statistics" description="Active reading time and chapter completions. Turning this off stops new collection." checked={prefs.analytics?.enabled !== false} onChange={(v) => setPrefs({ analytics: { enabled: v } })} />
          <button className="btn-outline w-full" onClick={() => clear(false)}><Hourglass className="h-4 w-4" />Clear reading history</button>
          <button className="btn-danger w-full" onClick={() => clear(true)}><Trash2 className="h-4 w-4" />Delete history & statistics</button>
        </div>
        <div className="card p-4 text-xs text-muted space-y-1.5">
          <p className="flex gap-2"><Clock className="h-4 w-4 shrink-0" />Time counts only while the reader is visible and you've interacted within the last two minutes.</p>
          <p className="flex gap-2"><BookOpen className="h-4 w-4 shrink-0" />Chapters count once you reach the end after a plausible reading time.</p>
          <p className="flex gap-2"><Trophy className="h-4 w-4 shrink-0" />The same rules keep rankings fair.</p>
          <p className="flex gap-2"><Sparkles className="h-4 w-4 shrink-0" />Manually marked chapters update your library but not your stats.</p>
        </div>
      </aside>
    </div>
  );
}
