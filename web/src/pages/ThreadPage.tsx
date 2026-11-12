import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Pin } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { timeAgo } from '@/lib/format';
import { Avatar, ErrorState, PageLoader, RichText, Spoiler, UserLink } from '@/components/ui';
import { ReportButton } from '@/components/titles';
import { Comments } from '@/components/comments';

export default function ThreadPage() {
  const id = useParams().id!;
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['thread', id], queryFn: () => api.get<any>(`/threads/${id}`) });
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const t = q.data;
  const isMod = user?.role === 'moderator' || user?.role === 'admin';
  const mine = user?.id === t.user.id;
  const patch = (p: object) => api.patch(`/threads/${id}`, p).then(() => q.refetch()).catch((e) => toast(e.message, 'error'));
  return (
    <div className="max-w-3xl mx-auto">
      <Link to={`/title/${enc(t.titleId)}?tab=discussions`} className="btn-ghost -ml-3 mb-3"><ArrowLeft className="h-4 w-4" />{t.title?.title ?? 'Back'}</Link>
      <article className="card p-5">
        <div className="text-xs text-muted uppercase tracking-wide flex items-center gap-2">{t.category}{t.pinned && <span className="inline-flex items-center gap-1 text-primary"><Pin className="h-3 w-3" />Pinned</span>}{t.locked && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />Locked</span>}</div>
        <h1 className="font-display text-2xl font-bold mt-1">{t.subject}</h1>
        <div className="flex items-center gap-2 mt-3 text-sm"><Avatar user={t.user} size={26} /><UserLink user={t.user} /><span className="text-muted">· {timeAgo(t.createdAt)}</span></div>
        <div className="mt-4 text-sm leading-relaxed">
          {editing ? (
            <div className="space-y-2"><textarea className="textarea" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex gap-2"><button className="btn-primary h-8" onClick={() => patch({ body }).then(() => setEditing(false))}>Save</button><button className="btn-ghost h-8" onClick={() => setEditing(false)}>Cancel</button></div></div>
          ) : t.spoiler ? <Spoiler label="This discussion contains spoilers"><RichText text={t.body} /></Spoiler> : <RichText text={t.body} />}
        </div>
        <div className="flex flex-wrap gap-3 mt-4 text-xs text-muted">
          {mine && !editing && <button className="hover:text-fg" onClick={() => { setBody(t.body); setEditing(true); }}>Edit</button>}
          {(mine || isMod) && <button className="hover:text-danger" onClick={async () => { if (confirm('Delete this discussion?')) { await api.del(`/threads/${id}`); nav(`/title/${enc(t.titleId)}?tab=discussions`); } }}>Delete</button>}
          {isMod && <button className="hover:text-fg" onClick={() => patch({ pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</button>}
          {isMod && <button className="hover:text-fg" onClick={() => patch({ locked: !t.locked })}>{t.locked ? 'Unlock' : 'Lock'}</button>}
          {!mine && <ReportButton targetType="thread" targetId={t.id} />}
        </div>
      </article>
      <div className="mt-8">{t.locked ? <p className="text-sm text-muted mb-4 flex items-center gap-2"><Lock className="h-4 w-4" />This discussion is locked. Existing replies are shown below.</p> : null}
        <Comments targetType="thread" targetId={t.id} canPin={mine} /></div>
    </div>
  );
}
