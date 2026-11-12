import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Crown, MessageSquare, Search, Star, UserCheck, UserPlus, UserX } from 'lucide-react';
import { api, enc, qs } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { GENRES, cls, duration, timeAgo } from '@/lib/format';
import type { Activity, ListDTO, MiniUser, Presence } from '@/lib/types';
import { Avatar, Empty, ErrorState, RichText, Segmented, Select, Spinner, Spoiler, Tabs, UserLink, useDebounced } from '@/components/ui';
import { ActivityItem } from '@/components/feed';
import { Cover } from '@/components/ui';
import { titleHref } from '@/components/titles';
import { ListCard } from './Lists';

type Tab = 'feed' | 'discussions' | 'rankings' | 'friends' | 'lists';

export default function Community() {
  const tab = (useParams().tab as Tab) ?? 'feed';
  const nav = useNavigate();
  const { user } = useAuth();
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-4">Community</h1>
      <Tabs value={tab} onChange={(v) => nav(`/community/${v}`)} className="mb-5" tabs={[
        { id: 'feed', label: 'Activity' }, { id: 'discussions', label: 'Discussions' }, { id: 'rankings', label: 'Rankings' },
        ...(user ? [{ id: 'friends' as const, label: 'Friends' }] : []), { id: 'lists', label: 'Public lists' },
      ]} />
      {tab === 'feed' && <Feed />}
      {tab === 'discussions' && <Discussions />}
      {tab === 'rankings' && <Rankings />}
      {tab === 'friends' && user && <Friends />}
      {tab === 'lists' && <PublicLists />}
      <p className="text-xs text-muted mt-10">Be kind, tag spoilers, and follow the <Link to="/guidelines" className="link">community guidelines</Link>.</p>
    </div>
  );
}

function Feed() {
  const { user } = useAuth();
  const [scope, setScope] = useState<'following' | 'global'>(user ? 'following' : 'global');
  const q = useQuery({ queryKey: ['feed', scope], enabled: !!user, queryFn: () => api.get<Activity[]>(`/feed?scope=${scope}&limit=50`) });
  if (!user) return <Empty title="Sign in to see activity">Follow readers to see what they're reading, finishing and recommending. <Link to="/login" className="link">Sign in</Link></Empty>;
  return (
    <div className="max-w-2xl">
      <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'following', label: 'Following & friends' }, { value: 'global', label: 'Everyone' }]} />
      <div className="card px-4 py-1 mt-4">
        {q.isLoading ? <div className="py-6"><Spinner /></div> : q.error ? <ErrorState compact error={q.error} /> : !q.data?.length ? (
          <p className="text-sm text-muted py-6">{scope === 'following' ? 'No activity yet. Follow people from Rankings or their profiles.' : 'No public activity yet.'}</p>
        ) : <ul className="divide-y divide-border/60">{q.data.map((a) => <ActivityItem key={a.id} a={a} />)}</ul>}
      </div>
    </div>
  );
}

function Discussions() {
  const [sort, setSort] = useState<'active' | 'new' | 'top'>('active');
  const threads = useQuery({ queryKey: ['threads', 'all', sort], queryFn: () => api.get<any[]>(`/threads?sort=${sort}&limit=40`) });
  const reviews = useQuery({ queryKey: ['reviews', 'recent'], queryFn: () => api.get<any[]>('/reviews/recent') });
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-6">
      <div>
        <div className="flex items-center justify-between mb-3"><h2 className="h-section">Discussions</h2><Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'active', label: 'Active' }, { value: 'new', label: 'New' }, { value: 'top', label: 'Top' }]} /></div>
        {threads.isLoading ? <Spinner /> : !threads.data?.length ? <p className="text-sm text-muted">No discussions yet. Start one from any title's Discussions tab.</p> : (
          <ul className="card divide-y divide-border/60">{threads.data.map((t) => (
            <li key={t.id}><Link to={`/threads/${t.id}`} className="flex gap-3 p-3 hover:bg-hover/[0.04]">
              {t.title?.coverUrl ? <img src={t.title.coverUrl} alt="" className="h-14 w-10 rounded-sm object-cover shrink-0" loading="lazy" /> : <span className="h-14 w-10 rounded-sm bg-surface-2 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted truncate">{t.title?.title} · {t.category}</div>
                <div className="font-medium line-clamp-1">{t.pinned && '📌 '}{t.subject}</div>
                <div className="text-xs text-muted">{t.user.displayName} · active {timeAgo(t.lastActivityAt)}{t.spoiler && ' · spoilers'}</div>
              </div>
              <span className="text-xs text-muted inline-flex items-center gap-1 self-center"><MessageSquare className="h-3.5 w-3.5" />{t.replyCount}</span>
            </Link></li>
          ))}</ul>
        )}
      </div>
      <div>
        <h2 className="h-section mb-3">Recent reviews</h2>
        {reviews.isLoading ? <Spinner /> : !reviews.data?.length ? <p className="text-sm text-muted">No reviews yet.</p> : (
          <div className="space-y-3">{reviews.data.map((r) => (
            <article key={r.id} className="card p-3 text-sm">
              <div className="flex items-center gap-2 mb-1"><Avatar user={r.user} size={22} /><UserLink user={r.user} /><span className="ml-auto inline-flex items-center gap-0.5 text-xs"><Star className="h-3 w-3 fill-warning text-warning" />{r.rating}</span></div>
              <Link to={`/title/${enc(r.titleId)}?tab=reviews`} className="text-xs text-primary hover:underline">{r.title?.title}</Link>
              <div className="mt-1 line-clamp-4 text-fg/90">{r.spoiler ? <Spoiler label="Contains spoilers"><RichText text={r.body} /></Spoiler> : <RichText text={r.body} />}</div>
            </article>
          ))}</div>
        )}
      </div>
    </div>
  );
}

const CATS = [
  ['chapters', 'Most chapters read'], ['completed', 'Most manga completed'], ['novels', 'Most light novels completed'], ['time', 'Longest reading time'],
  ['active', 'Most active readers'], ['community', 'Most active community members'], ['top_rated', 'Highest-rated titles'], ['popular_titles', 'Most popular titles'], ['lists', 'Most popular lists'],
] as const;

function Rankings() {
  const { user } = useAuth();
  const [cat, setCat] = useState<(typeof CATS)[number][0]>('chapters');
  const [period, setPeriod] = useState('week');
  const [scope, setScope] = useState('global');
  const [genre, setGenre] = useState('');
  const genreable = ['chapters', 'completed', 'novels', 'time', 'active', 'top_rated', 'popular_titles'].includes(cat);
  const q = useQuery({ queryKey: ['rankings', cat, period, scope, genre], queryFn: () => api.get<any>(`/rankings/${cat}${qs({ period, scope, genre: genreable ? genre : '' })}`) });
  const fmt = (v: number) => (cat === 'time' ? duration(v) : cat === 'active' ? `${v} days` : cat === 'community' ? `${v} pts` : v.toLocaleString());
  const isUsers = q.data?.kind === 'users';
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Select className="w-64" label="Category" value={cat} onChange={setCat} options={CATS.map(([value, label]) => ({ value, label }))} />
        <Segmented size="sm" value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }, { value: 'all', label: 'All time' }]} />
        {!['top_rated', 'popular_titles', 'lists'].includes(cat) && <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'global', label: 'Global' }, ...(user ? [{ value: 'friends', label: 'Friends' }, { value: 'region', label: 'My region' }] : [])]} />}
        {genreable && <Select className="w-44" label="Genre" value={genre} onChange={setGenre} options={[{ value: '', label: 'All genres' }, ...GENRES.map((g) => ({ value: g, label: g }))]} />}
      </div>
      {scope === 'region' && q.data && !q.data.regionSet && <p className="text-sm text-muted mb-3">Set a region on your profile (Settings → Profile) to see regional rankings. It's optional and only used for this.</p>}
      {isUsers && q.data.me && <div className="card p-3 mb-3 text-sm flex items-center gap-3"><Crown className="h-4 w-4 text-warning" />You're <b>#{q.data.me.rank}</b> with {fmt(q.data.me.value)}</div>}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data.items.length ? <p className="text-sm text-muted py-6">No one on this board yet — get reading!</p> : (
        <ol className="card divide-y divide-border/60">{q.data.items.map((it: any) => (
          <li key={it.rank} className={cls('flex items-center gap-3 p-3', it.user?.id === user?.id && 'bg-primary/5')}>
            <span className={cls('w-8 text-center font-display font-bold tabular-nums', it.rank === 1 ? 'text-warning text-lg' : it.rank <= 3 ? 'text-fg' : 'text-muted')}>{it.rank}</span>
            {q.data.kind === 'users' && <><Avatar user={it.user} size={36} /><Link to={`/u/${it.user.username}`} className="flex-1 min-w-0 font-medium truncate hover:text-primary">{it.user.displayName}<span className="text-xs text-muted font-normal ml-1.5">@{it.user.username}</span></Link></>}
            {q.data.kind === 'titles' && <><Cover src={it.title.coverUrl} alt={it.title.title} className="w-9" /><Link to={titleHref(it.title)} className="flex-1 min-w-0 font-medium truncate hover:text-primary">{it.title.title}</Link></>}
            {q.data.kind === 'lists' && <><Link to={`/lists/${it.list.id}`} className="flex-1 min-w-0"><div className="font-medium truncate hover:text-primary">{it.list.name}</div><div className="text-xs text-muted">by {it.user.displayName} · {it.list.items} titles</div></Link></>}
            <span className="text-sm tabular-nums text-muted">{q.data.kind === 'titles' && cat === 'top_rated' ? `★ ${it.extra.avg} (${it.extra.ratings})` : q.data.kind === 'titles' ? `${it.value} readers` : q.data.kind === 'lists' ? `♥ ${it.value}` : fmt(it.value)}</span>
          </li>
        ))}</ol>
      )}
      <p className="text-xs text-muted mt-3">Rankings use validated reading activity only (active reading time and plausibly-read chapters, capped per day). Users can opt out in privacy settings.</p>
    </div>
  );
}

function Friends() {
  const q = useQuery({ queryKey: ['friends'], queryFn: () => api.get<{ friends: (MiniUser & { presence: Presence })[]; incoming: MiniUser[]; outgoing: MiniUser[] }>('/friends') });
  const [s, setS] = useState('');
  const ds = useDebounced(s, 300);
  const search = useQuery({ queryKey: ['user-search', ds], enabled: ds.length >= 2, queryFn: () => api.get<MiniUser[]>(`/users/search?q=${enc(ds)}`) });
  const toast = useToast();
  const act = (p: Promise<unknown>, msg?: string) => p.then(() => { q.refetch(); msg && toast(msg, 'success'); }).catch((e) => toast(e.message, 'error'));
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-6">
        {!!q.data?.incoming.length && (
          <section><h2 className="h-section mb-3">Friend requests</h2>
            <ul className="card divide-y divide-border/60">{q.data.incoming.map((u) => (
              <li key={u.id} className="flex items-center gap-3 p-3"><Avatar user={u} size={36} /><Link to={`/u/${u.username}`} className="flex-1 font-medium hover:underline">{u.displayName}</Link>
                <button className="btn-primary h-8" onClick={() => act(api.post(`/u/${u.username}/friend/respond`, { accept: true }), 'Friend added')}><UserCheck className="h-4 w-4" />Accept</button>
                <button className="btn-ghost h-8" onClick={() => act(api.post(`/u/${u.username}/friend/respond`, { accept: false }))}><UserX className="h-4 w-4" /></button></li>
            ))}</ul></section>
        )}
        <section><h2 className="h-section mb-3">Friends {q.data && <span className="text-sm text-muted font-normal">{q.data.friends.length}</span>}</h2>
          {q.isLoading ? <Spinner /> : !q.data?.friends.length ? <p className="text-sm text-muted">No friends yet. Search for readers on the right.</p> : (
            <ul className="grid sm:grid-cols-2 gap-2">{q.data.friends.map((u) => (
              <li key={u.id} className="card p-3 flex items-center gap-3">
                <span className="relative"><Avatar user={u} size={38} />{u.presence.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-success ring-2 ring-card" aria-label="Online" />}</span>
                <div className="flex-1 min-w-0"><Link to={`/u/${u.username}`} className="font-medium hover:underline truncate block">{u.displayName}</Link><div className="text-xs text-muted">{u.presence.online ? 'Online' : u.presence.lastSeenAt ? `Seen ${timeAgo(u.presence.lastSeenAt)}` : `@${u.username}`}</div></div>
                <Link to={`/messages?to=${u.username}`} className="btn-icon" aria-label={`Message ${u.displayName}`}><MessageSquare className="h-4 w-4" /></Link>
              </li>
            ))}</ul>
          )}
        </section>
        {!!q.data?.outgoing.length && <section><h2 className="text-sm font-medium text-muted mb-2">Sent requests</h2><div className="flex flex-wrap gap-2">{q.data.outgoing.map((u) => <span key={u.id} className="chip">{u.displayName}<button onClick={() => act(api.del(`/u/${u.username}/friend`))} aria-label="Cancel request">×</button></span>)}</div></section>}
      </div>
      <aside>
        <h2 className="h-section mb-3">Find readers</h2>
        <div className="relative"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by username" value={s} onChange={(e) => setS(e.target.value)} /></div>
        <ul className="mt-3 space-y-1">{search.data?.map((u) => (
          <li key={u.id} className="flex items-center gap-2 p-2 rounded hover:bg-hover/[0.04]"><Avatar user={u} size={30} /><Link to={`/u/${u.username}`} className="flex-1 text-sm font-medium truncate">{u.displayName} <span className="text-muted font-normal">@{u.username}</span></Link>
            <button className="btn-icon h-8 w-8" aria-label={`Add ${u.displayName}`} onClick={() => act(api.post(`/u/${u.username}/friend`), 'Request sent')}><UserPlus className="h-4 w-4" /></button></li>
        ))}</ul>
      </aside>
    </div>
  );
}

function PublicLists() {
  const [sort, setSort] = useState<'popular' | 'recent'>('popular');
  const [s, setS] = useState('');
  const ds = useDebounced(s, 300);
  const q = useQuery({ queryKey: ['lists', 'public', sort, ds], queryFn: () => api.get<ListDTO[]>(`/lists/public${qs({ sort, q: ds })}`) });
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4"><input className="input max-w-xs" placeholder="Search lists" value={s} onChange={(e) => setS(e.target.value)} /><Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'popular', label: 'Popular' }, { value: 'recent', label: 'Recent' }]} /></div>
      {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-muted">No public lists yet.</p> : <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{q.data.map((l) => <ListCard key={l.id} l={l} />)}</div>}
    </div>
  );
}
