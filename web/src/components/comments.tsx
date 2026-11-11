import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowBigDown, ArrowBigUp, CornerDownRight, EyeOff, MoreHorizontal, Pin, SmilePlus } from 'lucide-react';
import { api, enc, qs } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { cls, timeAgo } from '@/lib/format';
import type { Comment } from '@/lib/types';
import { Avatar, ErrorState, Menu, MenuItem, RichText, Segmented, Spinner, Spoiler, UserLink } from './ui';
import { ReportButton } from './titles';

type Target = { targetType: 'chapter' | 'thread' | 'list'; targetId: string };
interface Node extends Comment { children: Node[] }

export function Comments({ targetType, targetId, canPin = false, compact = false }: Target & { canPin?: boolean; compact?: boolean }) {
  const [sort, setSort] = useState<'top' | 'new' | 'old'>('top');
  const key = ['comments', targetType, targetId, sort];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ comments: Comment[]; reactions: string[]; total: number }>(`/comments${qs({ targetType, targetId, sort })}`) });
  const { user } = useAuth();
  const tree = useMemo(() => {
    const map = new Map<string, Node>();
    (q.data?.comments ?? []).forEach((c) => map.set(c.id, { ...c, children: [] }));
    const roots: Node[] = [];
    for (const c of map.values()) (c.parentId && map.get(c.parentId) ? map.get(c.parentId)!.children : roots).push(c);
    return roots;
  }, [q.data]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display font-semibold">{q.data ? `${q.data.total} comment${q.data.total === 1 ? '' : 's'}` : 'Comments'}</h3>
        <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'top', label: 'Popular' }, { value: 'new', label: 'Newest' }, { value: 'old', label: 'Oldest' }]} />
      </div>
      {user ? <Composer target={{ targetType, targetId }} /> : <p className="text-sm text-muted mb-4"><Link to="/login" className="link">Sign in</Link> to join the discussion.</p>}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState compact error={q.error} retry={q.refetch} /> : !tree.length ? (
        <p className="text-sm text-muted py-6 text-center">No comments yet — start the conversation.</p>
      ) : (
        <ul className={cls('space-y-4', compact ? 'mt-4' : 'mt-6')}>{tree.map((c) => <CommentNode key={c.id} c={c} target={{ targetType, targetId }} reactions={q.data!.reactions} canPin={canPin} />)}</ul>
      )}
    </div>
  );
}

function Composer({ target, parentId, onDone, initial, editId }: { target: Target; parentId?: string; onDone?: () => void; initial?: { body: string; spoiler: boolean }; editId?: string }) {
  const [body, setBody] = useState(initial?.body ?? '');
  const [spoiler, setSpoiler] = useState(initial?.spoiler ?? false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      if (editId) await api.patch(`/comments/${editId}`, { body, spoiler });
      else {
        const r = await api.post<{ held: boolean }>('/comments', { ...target, parentId, body, spoiler });
        if (r.held) toast('Your comment is held for moderator review.', 'info');
      }
      setBody('');
      setSpoiler(false);
      qc.invalidateQueries({ queryKey: ['comments', target.targetType, target.targetId] });
      onDone?.();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <textarea className="textarea" rows={parentId || editId ? 2 : 3} maxLength={5000} placeholder={parentId ? 'Write a reply…' : 'Share your thoughts… wrap ||spoilers|| in double bars'} value={body}
        onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"><input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /><EyeOff className="h-3.5 w-3.5" />Mark whole comment as spoiler</label>
        <div className="flex-1" />
        {onDone && <button className="btn-ghost h-8" onClick={onDone}>Cancel</button>}
        <button className="btn-primary h-8" disabled={busy || !body.trim()} onClick={submit}>{busy ? <Spinner className="h-4 w-4" /> : editId ? 'Save' : parentId ? 'Reply' : 'Post'}</button>
      </div>
    </div>
  );
}

function CommentNode({ c, target, reactions, canPin }: { c: Node; target: Target; reactions: string[]; canPin: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [vote, setVote] = useState({ score: c.score, mine: c.myVote });
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', target.targetType, target.targetId] });
  const doVote = async (v: 1 | -1) => {
    if (!user) return toast('Sign in to vote', 'info');
    const next = vote.mine === v ? 0 : v;
    setVote({ score: vote.score - vote.mine + next, mine: next });
    try { await api.post(`/comments/${c.id}/vote`, { value: next }); } catch (e: any) { toast(e.message, 'error'); }
  };
  const act = (fn: () => Promise<unknown>) => fn().then(refresh).catch((e) => toast(e.message, 'error'));
  const isMod = user?.role === 'moderator' || user?.role === 'admin';
  const removed = c.deleted || (c.hidden && !c.mine && !isMod);

  return (
    <li>
      <div className={cls('flex gap-3', c.pinned && 'bg-primary/5 -mx-2 px-2 py-2 rounded')}>
        <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand thread' : 'Collapse thread'} className="shrink-0">{c.user ? <Avatar user={c.user} size={30} /> : <span className="h-[30px] w-[30px] rounded-full bg-surface-2 block" />}</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <UserLink user={c.user} />
            <span className="text-xs text-muted">{timeAgo(c.createdAt)}{c.editedAt && ' · edited'}</span>
            {c.pinned && <span className="text-xs text-primary inline-flex items-center gap-1"><Pin className="h-3 w-3" />Pinned</span>}
            {c.hidden && !c.deleted && <span className="text-xs text-warning">Held for review</span>}
          </div>
          {!collapsed && (
            <>
              <div className="mt-1 text-sm leading-relaxed">
                {removed ? <span className="italic text-muted">[comment removed]</span> : editing ? (
                  <Composer target={target} editId={c.id} initial={{ body: c.body, spoiler: c.spoiler }} onDone={() => setEditing(false)} />
                ) : c.spoiler ? <Spoiler><RichText text={c.body} /></Spoiler> : <RichText text={c.body} />}
              </div>
              {!removed && !editing && (
                <div className="flex items-center gap-1 mt-1.5 -ml-1.5 text-muted">
                  <button onClick={() => doVote(1)} className={cls('btn-icon h-7 w-7', vote.mine === 1 && 'text-primary')} aria-label="Like" aria-pressed={vote.mine === 1}><ArrowBigUp className={cls('h-4 w-4', vote.mine === 1 && 'fill-current')} /></button>
                  <span className="text-xs tabular-nums min-w-4 text-center">{vote.score}</span>
                  <button onClick={() => doVote(-1)} className={cls('btn-icon h-7 w-7', vote.mine === -1 && 'text-danger')} aria-label="Dislike" aria-pressed={vote.mine === -1}><ArrowBigDown className={cls('h-4 w-4', vote.mine === -1 && 'fill-current')} /></button>
                  {c.reactions.map((r) => (
                    <button key={r.emoji} onClick={() => user && act(() => api.post(`/comments/${c.id}/react`, { emoji: r.emoji }))} className={cls('h-6 px-1.5 rounded-full border text-xs flex items-center gap-1', r.mine ? 'border-primary/60 bg-primary/10 text-fg' : 'border-border')}>{r.emoji} {r.count}</button>
                  ))}
                  {user && (
                    <Menu align="left" trigger={() => <button className="btn-icon h-7 w-7" aria-label="Add reaction"><SmilePlus className="h-4 w-4" /></button>}>
                      {(close) => <div className="flex gap-1 px-2 py-1">{reactions.map((e) => <button key={e} className="h-8 w-8 rounded hover:bg-hover/[0.08] text-lg" onClick={() => { act(() => api.post(`/comments/${c.id}/react`, { emoji: e })); close(); }}>{e}</button>)}</div>}
                    </Menu>
                  )}
                  {user && c.depth < 8 && <button className="text-xs font-medium hover:text-fg px-2 h-7 inline-flex items-center gap-1" onClick={() => setReplying(!replying)}><CornerDownRight className="h-3.5 w-3.5" />Reply</button>}
                  {user && (
                    <Menu align="left" trigger={() => <button className="btn-icon h-7 w-7" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></button>}>
                      {(close) => (
                        <>
                          {c.mine && <MenuItem onClick={() => { setEditing(true); close(); }}>Edit</MenuItem>}
                          {(c.mine || isMod) && <MenuItem danger onClick={() => { if (confirm('Delete this comment?')) act(() => api.del(`/comments/${c.id}`)); close(); }}>Delete</MenuItem>}
                          {(canPin || isMod) && <MenuItem onClick={() => { act(() => api.post(`/comments/${c.id}/pin`)); close(); }}>{c.pinned ? 'Unpin' : 'Pin'}</MenuItem>}
                          {!c.mine && <div className="px-3 py-2"><ReportButton targetType="comment" targetId={c.id} /></div>}
                        </>
                      )}
                    </Menu>
                  )}
                </div>
              )}
              {replying && <div className="mt-2"><Composer target={target} parentId={c.id} onDone={() => setReplying(false)} /></div>}
            </>
          )}
          {collapsed && c.children.length > 0 && <button className="text-xs text-muted mt-1" onClick={() => setCollapsed(false)}>{c.children.length} more repl{c.children.length === 1 ? 'y' : 'ies'}</button>}
          {!collapsed && c.children.length > 0 && (
            <ul className="mt-3 space-y-4 border-l border-border pl-3 sm:pl-4">{c.children.map((ch) => <CommentNode key={ch.id} c={ch} target={target} reactions={reactions} canPin={canPin} />)}</ul>
          )}
        </div>
      </div>
    </li>
  );
}

