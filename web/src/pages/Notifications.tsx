import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, BookOpen, CheckCheck, Heart, ListChecks, Megaphone, MessageCircle, Settings, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { setUnreadCounts } from '@/hooks/app';
import { cls, timeAgo } from '@/lib/format';
import type { Notification } from '@/lib/types';
import { Avatar, Empty, Spinner } from '@/components/ui';

const ICONS: Record<string, typeof Bell> = { chapter: BookOpen, author: BookOpen, friend: UserPlus, follow: Users, message: MessageCircle, reply: AtSign, reaction: Heart, list: ListChecks, community: Users, system: Megaphone };
const FILTERS = [['', 'All'], ['chapter', 'Chapters'], ['reply', 'Replies'], ['reaction', 'Reactions'], ['friend', 'Friends'], ['follow', 'Follows'], ['message', 'Messages'], ['list', 'Lists'], ['community', 'Community'], ['system', 'Announcements']];

export default function Notifications() {
  const [kind, setKind] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['notifications', kind, unreadOnly], initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<{ items: Notification[]; unread: number }>(`/notifications?limit=30&offset=${pageParam}${kind ? `&kind=${kind}` : ''}${unreadOnly ? '&unread=1' : ''}`),
    getNextPageParam: (last, pages) => (last.items.length === 30 ? pages.length * 30 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  useEffect(() => { if (q.data) setUnreadCounts({ notifications: unread }); }, [unread, q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const open = async (n: Notification) => {
    if (!n.read) await api.post('/notifications/read', { ids: [n.id] });
    refresh();
    if (n.link) nav(n.link);
  };
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-2xl font-bold flex-1">Notifications {unread > 0 && <span className="text-base text-muted font-normal">{unread} unread</span>}</h1>
        <button className="btn-outline" disabled={!unread} onClick={() => api.post('/notifications/read', { all: true }).then(refresh)}><CheckCheck className="h-4 w-4" />Mark all read</button>
        <button className="btn-ghost" onClick={() => confirm('Clear all read notifications?') && api.del('/notifications', { readOnly: true }).then(refresh)}><Trash2 className="h-4 w-4" />Clear read</button>
        <Link to="/settings/notifications" className="btn-icon" aria-label="Notification settings"><Settings className="h-4 w-4" /></Link>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {FILTERS.map(([v, l]) => <button key={v} className={cls(kind === v ? 'chip-on' : 'chip', 'shrink-0')} onClick={() => setKind(v)}>{l}</button>)}
        <button className={cls(unreadOnly ? 'chip-on' : 'chip', 'shrink-0')} onClick={() => setUnreadOnly(!unreadOnly)}>Unread only</button>
      </div>
      {q.isLoading ? <Spinner /> : !items.length ? <Empty icon={<Bell />} title="You're all caught up">New chapters, replies, friend requests and more will show up here.</Empty> : (
        <ul className="card divide-y divide-border/60">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell;
            return (
              <li key={n.id} className={cls('flex items-start gap-3 p-3 hover:bg-hover/[0.04] cursor-pointer', !n.read && 'bg-primary/[0.06]')} onClick={() => open(n)}>
                <div className="relative shrink-0">
                  {n.actor ? <Avatar user={n.actor as any} size={38} /> : <span className="h-[38px] w-[38px] rounded-full bg-surface-2 flex items-center justify-center"><Icon className="h-4 w-4 text-muted" /></span>}
                  {n.actor && <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-card border border-border flex items-center justify-center"><Icon className="h-3 w-3 text-primary" /></span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cls('text-sm', !n.read && 'font-medium')}>{n.title}</div>
                  {n.body && <div className="text-sm text-muted line-clamp-2">{n.body}</div>}
                  <div className="text-xs text-muted mt-0.5">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.read && <span className="h-2 w-2 rounded-full bg-primary mt-2" aria-label="Unread" />}
                <button className="btn-icon h-7 w-7" aria-label="Delete notification" onClick={(e) => { e.stopPropagation(); api.del('/notifications', { ids: [n.id] }).then(refresh); }}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            );
          })}
        </ul>
      )}
      {q.hasNextPage && <div className="text-center mt-4"><button className="btn-outline" onClick={() => q.fetchNextPage()}>Load more</button></div>}
    </div>
  );
}
