import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ExternalLink, Lock, MapPin, MessageSquare, MoreHorizontal, Pencil, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { duration, timeAgo } from '@/lib/format';
import type { Activity, Entry, MiniUser, Title } from '@/lib/types';
import { Avatar, ErrorState, Menu, MenuItem, Modal, PageLoader, RichText, Section, Spinner } from '@/components/ui';
import { ReportButton, Stat, TitleCard, TitleRow } from '@/components/titles';
import { ActivityItem } from '@/components/feed';
import { Heatmap } from '@/components/charts';

interface ProfileResp {
  user: MiniUser & { bio: string; bannerUrl: string | null; accent: string | null; region: string | null; joinedAt: string; isPublic: boolean };
  restricted: boolean;
  presence: { online: boolean; lastSeenAt: string | null };
  relationship: null | { following: boolean; followsYou: boolean; friend: 'none' | 'friends' | 'incoming' | 'outgoing'; blocked: boolean; muted: boolean };
  counts: { followers: number; following: number; friends: number };
  sections: {
    currentlyReading: { entry: Entry; title: Title }[] | null; completed: { entry: Entry; title: Title }[] | null; favorites: { entry: Entry; title: Title }[] | null;
    favoriteGenres: string[] | null; stats: any; integrations: { provider: string; name: string; url: string }[];
    lists: { id: string; name: string; slug: string; coverUrl: string | null; items: number }[] | null; activity: Activity[] | null;
  };
}

export default function Profile() {
  const username = useParams().username!;
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api.get<ProfileResp>(`/u/${enc(username)}`) });
  const [social, setSocial] = useState<null | 'followers' | 'following' | 'friends'>(null);
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data!;
  const r = p.relationship;
  const isMe = user?.id === p.user.id;
  const act = (fn: () => Promise<unknown>, msg?: string) => fn().then(() => { q.refetch(); msg && toast(msg, 'success'); }).catch((e) => toast(e.message, 'error'));
  const s = p.sections;

  return (
    <div className="-mt-5">
      <div className="relative -mx-4 h-40 sm:h-56 overflow-hidden" style={{ background: p.user.accent ? `linear-gradient(135deg, ${p.user.accent}, rgb(var(--c-bg)))` : 'linear-gradient(135deg, rgb(var(--c-primary) / .5), rgb(var(--c-accent) / .3))' }}>
        {p.user.bannerUrl && <img src={p.user.bannerUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-14 relative">
        <span className="relative w-fit"><Avatar user={p.user} size={112} className="ring-4 ring-bg" />{p.presence.online && <span className="absolute bottom-2 right-2 h-5 w-5 rounded-full bg-success ring-4 ring-bg" aria-label="Online" />}</span>
        <div className="flex-1 min-w-0 sm:pb-2">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">{p.user.displayName}{!p.user.isPublic && <Lock className="h-4 w-4 text-muted" aria-label="Private profile" />}</h1>
          <div className="text-sm text-muted flex flex-wrap gap-x-3">
            <span>@{p.user.username}</span>
            {p.user.region && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{p.user.region}</span>}
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Joined {new Date(p.user.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            {!p.presence.online && p.presence.lastSeenAt && <span>Seen {timeAgo(p.presence.lastSeenAt)}</span>}
            {r?.followsYou && <span className="text-primary">Follows you</span>}
          </div>
          <div className="flex gap-4 mt-2 text-sm">
            {(['followers', 'following', 'friends'] as const).map((k) => <button key={k} className="hover:underline" onClick={() => setSocial(k)}><b>{p.counts[k]}</b> <span className="text-muted">{k}</span></button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:pb-2">
          {isMe ? <Link to="/settings/profile" className="btn-outline"><Pencil className="h-4 w-4" />Edit profile</Link> : user && r && !r.blocked && (
            <>
              <button className={r.following ? 'btn-outline' : 'btn-primary'} onClick={() => act(() => (r.following ? api.del(`/u/${username}/follow`) : api.post(`/u/${username}/follow`)))}>{r.following ? 'Following' : 'Follow'}</button>
              {r.friend === 'none' && <button className="btn-outline" onClick={() => act(() => api.post(`/u/${username}/friend`), 'Friend request sent')}><UserPlus className="h-4 w-4" />Add friend</button>}
              {r.friend === 'outgoing' && <button className="btn-outline" onClick={() => act(() => api.del(`/u/${username}/friend`))}>Request sent</button>}
              {r.friend === 'incoming' && <button className="btn-primary" onClick={() => act(() => api.post(`/u/${username}/friend/respond`, { accept: true }), 'Friend added')}><UserCheck className="h-4 w-4" />Accept request</button>}
              <button className="btn-outline" onClick={() => nav(`/messages?to=${username}`)} aria-label="Message"><MessageSquare className="h-4 w-4" /></button>
              <Menu trigger={() => <button className="btn-icon" aria-label="More"><MoreHorizontal className="h-4 w-4" /></button>}>
                {(close) => (
                  <>
                    {r.friend === 'friends' && <MenuItem icon={<UserMinus />} onClick={() => { act(() => api.del(`/u/${username}/friend`)); close(); }}>Remove friend</MenuItem>}
                    <MenuItem onClick={() => { act(() => (r.muted ? api.del(`/u/${username}/block?kind=mute`) : api.post(`/u/${username}/block`, { kind: 'mute' })), r.muted ? 'Unmuted' : 'Muted — you won’t see their posts'); close(); }}>{r.muted ? 'Unmute' : 'Mute'}</MenuItem>
                    <MenuItem danger onClick={() => { if (confirm(`Block @${username}?`)) act(() => api.post(`/u/${username}/block`, { kind: 'block' }), 'Blocked'); close(); }}>Block</MenuItem>
                    <div className="px-3 py-2"><ReportButton targetType="user" targetId={p.user.id} /></div>
                  </>
                )}
              </Menu>
            </>
          )}
          {r?.blocked && <button className="btn-outline" onClick={() => act(() => api.del(`/u/${username}/block`), 'Unblocked')}>Unblock</button>}
        </div>
      </div>
      {p.user.bio && <p className="mt-4 max-w-2xl text-sm leading-relaxed"><RichText text={p.user.bio} /></p>}
      {!!s.integrations.length && <div className="flex gap-3 mt-3">{s.integrations.map((i) => <a key={i.provider} href={i.url} target="_blank" rel="noreferrer" className="chip"><ExternalLink className="h-3 w-3" />{i.provider === 'mal' ? 'MyAnimeList' : 'AniList'}: {i.name}</a>)}</div>}

      {p.restricted ? <div className="card p-8 mt-8 text-center text-muted"><Lock className="h-6 w-6 mx-auto mb-2" />This profile is private. Become friends to see their reading.</div> : (
        <div className="space-y-10 mt-8">
          {s.stats && (
            <Section title="Reading stats" action={(isMe || s.stats) && <Link to={isMe ? '/stats' : `/stats?user=${enc(username)}`} className="text-sm text-muted hover:text-fg">Details</Link>}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Stat label="Chapters read" value={s.stats.totals.chaptersRead.toLocaleString()} />
                <Stat label="Reading time" value={duration(s.stats.totals.totalSeconds)} />
                <Stat label="Completed" value={s.stats.library.completed} />
                <Stat label="Longest streak" value={`${s.stats.totals.longestStreak}d`} />
              </div>
              <div className="card p-4"><Heatmap days={s.stats.daily} /></div>
            </Section>
          )}
          {s.favoriteGenres && s.favoriteGenres.length > 0 && <Section title="Favorite genres"><div className="flex flex-wrap gap-2">{s.favoriteGenres.map((g) => <Link key={g} to={`/discover/search?genres=${enc(g)}`} className="chip h-8 px-3 text-sm">{g}</Link>)}</div></Section>}
          {s.currentlyReading && s.currentlyReading.length > 0 && <Section title="Currently reading"><TitleRow>{s.currentlyReading.map((x) => <TitleCard key={x.title.id} title={x.title} subtitle={`Ch. ${x.entry.progressChapter}`} />)}</TitleRow></Section>}
          {s.favorites && s.favorites.length > 0 && <Section title="Favorites"><TitleRow>{s.favorites.map((x) => <TitleCard key={x.title.id} title={x.title} subtitle={x.entry.rating ? `★ ${x.entry.rating}/10` : undefined} />)}</TitleRow></Section>}
          {s.completed && s.completed.length > 0 && <Section title="Completed"><TitleRow>{s.completed.map((x) => <TitleCard key={x.title.id} title={x.title} subtitle={x.entry.rating ? `★ ${x.entry.rating}/10` : 'Completed'} />)}</TitleRow></Section>}
          <div className="grid lg:grid-cols-2 gap-8">
            {s.lists && <Section title="Lists">{!s.lists.length ? <p className="text-sm text-muted">No public lists.</p> : <ul className="card divide-y divide-border/60">{s.lists.map((l) => <li key={l.id}><Link to={`/lists/${l.id}`} className="flex justify-between p-3 hover:bg-hover/[0.04] text-sm"><span className="font-medium">{l.name}</span><span className="text-muted">{l.items} titles</span></Link></li>)}</ul>}</Section>}
            {s.activity && <Section title="Recent activity">{!s.activity.length ? <p className="text-sm text-muted">No recent activity.</p> : <ul className="card px-4 py-1 divide-y divide-border/60">{s.activity.map((a) => <ActivityItem key={a.id} a={a} />)}</ul>}</Section>}
          </div>
        </div>
      )}
      {social && <SocialModal username={username} kind={social} onClose={() => setSocial(null)} />}
    </div>
  );
}

function SocialModal({ username, kind, onClose }: { username: string; kind: 'followers' | 'following' | 'friends'; onClose: () => void }) {
  const q = useQuery({ queryKey: ['social', username, kind], queryFn: () => api.get<(MiniUser & { presence: { online: boolean } })[]>(`/u/${enc(username)}/social?kind=${kind}`) });
  return (
    <Modal open onClose={onClose} title={kind[0].toUpperCase() + kind.slice(1)}>
      {q.isLoading ? <Spinner /> : q.error ? <p className="text-sm text-muted">{(q.error as Error).message}</p> : !q.data?.length ? <p className="text-sm text-muted">No one yet.</p> : (
        <ul className="space-y-1">{q.data.map((u) => <li key={u.id}><Link to={`/u/${u.username}`} onClick={onClose} className="flex items-center gap-3 p-2 rounded hover:bg-hover/[0.05]"><Avatar user={u} size={34} /><span className="text-sm font-medium flex-1">{u.displayName} <span className="text-muted font-normal">@{u.username}</span></span>{u.presence.online && <span className="h-2 w-2 rounded-full bg-success" />}</Link></li>)}</ul>
      )}
    </Modal>
  );
}
