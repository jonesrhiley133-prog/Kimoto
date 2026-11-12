import { Link } from 'react-router-dom';
import type { Activity } from '@/lib/types';
import { timeAgo } from '@/lib/format';
import { Avatar } from './ui';
import { titleHref } from './titles';

const VERB: Record<string, (a: Activity) => string> = {
  started: () => 'started reading',
  completed: () => 'completed',
  dropped: () => 'dropped',
  rated: (a) => `rated ${a.data.rating}/10`,
  reviewed: (a) => `reviewed (${a.data.rating}/10)`,
  favorited: () => 'favorited',
  list_created: (a) => `created the list “${a.data.name}”`,
  list_added: (a) => `added to “${a.data.list}”`,
  followed: (a) => `followed @${a.data.username}`,
};

export function ActivityItem({ a }: { a: Activity }) {
  return (
    <li className="flex gap-3 py-2.5">
      <Link to={`/u/${a.user.username}`}><Avatar user={a.user} size={34} /></Link>
      <div className="flex-1 min-w-0 text-sm">
        <Link to={`/u/${a.user.username}`} className="font-medium hover:underline">{a.user.displayName}</Link>{' '}
        <span className="text-muted">{(VERB[a.kind] ?? (() => a.kind))(a)}</span>{' '}
        {a.title && <Link to={titleHref(a.title)} className="font-medium hover:text-primary">{a.title.title}</Link>}
        {a.kind.startsWith('list') && a.targetId && <> · <Link to={`/lists/${a.targetId}`} className="link text-xs">view list</Link></>}
        <div className="text-xs text-muted mt-0.5">{timeAgo(a.createdAt)}</div>
      </div>
      {a.title?.coverUrl && <Link to={titleHref(a.title)} className="shrink-0"><img src={a.title.coverUrl} alt="" className="h-12 w-8 rounded-sm object-cover" loading="lazy" /></Link>}
    </li>
  );
}
