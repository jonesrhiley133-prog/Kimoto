import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { timeAgo } from '@/lib/format';
import { Avatar, Empty, Select, Spinner, Tabs } from '@/components/ui';
import { Stat } from '@/components/titles';

export default function Moderation() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'reports' | 'held' | 'filters' | 'users' | 'log' | 'announce' | 'emoji'>('reports');
  const overview = useQuery({ queryKey: ['mod', 'overview'], queryFn: () => api.get<any>('/mod/overview') });
  if (user?.role !== 'moderator' && user?.role !== 'admin') return <Navigate to="/" replace />;
  const admin = user.role === 'admin';
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-4">Moderation</h1>
      {overview.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Stat label="Open reports" value={overview.data.openReports} /><Stat label="Held comments" value={overview.data.heldComments} />
          <Stat label="Suspended users" value={overview.data.suspended.length} /><Stat label="Comments (24h)" value={overview.data.commentsToday} sub={`${overview.data.users} members`} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[
        { id: 'reports', label: 'Reports', count: overview.data?.openReports }, { id: 'held', label: 'Held for review', count: overview.data?.heldComments },
        { id: 'filters', label: 'Word filters' }, { id: 'users', label: 'Users' }, { id: 'emoji', label: 'Custom emoji' }, { id: 'log', label: 'Audit log' },
        ...(admin ? [{ id: 'announce' as const, label: 'Announcement' }] : []),
      ]} />
      {tab === 'reports' && <Reports onChange={() => overview.refetch()} />}
      {tab === 'held' && <Held onChange={() => overview.refetch()} />}
      {tab === 'filters' && <Filters />}
      {tab === 'users' && <Users admin={admin} suspended={overview.data?.suspended ?? []} onChange={() => overview.refetch()} />}
      {tab === 'emoji' && <Emoji />}
      {tab === 'log' && <Log />}
      {tab === 'announce' && admin && <Announce />}
    </div>
  );
}

function Reports({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('open');
  const q = useQuery({ queryKey: ['mod', 'reports', status], queryFn: () => api.get<any[]>(`/mod/reports?status=${status}`) });
  const toast = useToast();
  const resolve = (id: string, action: string) => {
    const days = action === 'suspend' ? Number(prompt('Suspend for how many days?', '7') ?? 0) : 7;
    if (action === 'suspend' && !days) return;
    const note = action === 'dismiss' ? '' : prompt('Note to the user (optional)') ?? '';
    api.post(`/mod/reports/${id}/resolve`, { action, days, note }).then(() => { q.refetch(); onChange(); toast('Done', 'success'); }).catch((e) => toast(e.message, 'error'));
  };
  return (
    <div>
      <Select className="w-40 mb-4" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }]} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon={<ShieldAlert />} title="No reports here" /> : (
        <ul className="space-y-3">{q.data.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded px-1.5 py-0.5 bg-danger/15 text-danger uppercase tracking-wide">{r.reason}</span>
              <span>{r.targetType}</span>{r.reports > 1 && <span className="text-warning">{r.reports} reports</span>}
              <span>· reported by {r.reporter?.username} {timeAgo(r.createdAt)}</span>
            </div>
            {r.target ? (
              <div className="mt-2 flex gap-3">
                <Avatar user={r.target.author} size={28} />
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r.target.author?.displayName} <span className="text-muted">@{r.target.author?.username}</span></div>
                  <p className="text-sm mt-1 whitespace-pre-wrap break-words bg-surface-2 rounded p-2">{r.target.text || <i className="text-muted">(empty)</i>}</p>
                  {(r.target.deleted || r.target.hidden) ? <p className="text-xs text-muted mt-1">Currently {r.target.deleted ? 'deleted' : 'hidden'}</p> : null}</div>
              </div>
            ) : <p className="text-sm text-muted mt-2">The reported content no longer exists.</p>}
            {r.details && <p className="text-sm mt-2"><b>Reporter's note:</b> {r.details}</p>}
            {r.status === 'open' ? (
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="btn-outline h-8" onClick={() => resolve(r.id, 'dismiss')}>Dismiss</button>
                {r.targetType === 'comment' && <button className="btn-outline h-8" onClick={() => resolve(r.id, 'hide')}>Hide</button>}
                {['comment', 'thread', 'review', 'message', 'list'].includes(r.targetType) && <button className="btn-danger h-8" onClick={() => resolve(r.id, 'delete')}>Remove content</button>}
                <button className="btn-outline h-8" onClick={() => resolve(r.id, 'warn')}>Warn user</button>
                <button className="btn-danger h-8" onClick={() => resolve(r.id, 'suspend')}>Suspend user</button>
              </div>
            ) : <p className="text-xs text-muted mt-2">Resolution: {r.resolution}</p>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function Held({ onChange }: { onChange: () => void }) {
  const q = useQuery({ queryKey: ['mod', 'held'], queryFn: () => api.get<any[]>('/mod/held') });
  const act = (p: Promise<unknown>) => p.then(() => { q.refetch(); onChange(); });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <Empty title="Nothing held for review">Comments matching “hide” word filters or reported by 3+ people appear here.</Empty>;
  return (
    <ul className="space-y-2">{q.data.map((c) => (
      <li key={c.id} className="card p-3 text-sm">
        <div className="text-xs text-muted">@{c.username} · {c.targetType} · {timeAgo(c.createdAt)}</div>
        <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
        <div className="flex gap-2 mt-2"><button className="btn-outline h-8" onClick={() => act(api.post(`/mod/comments/${c.id}/restore`))}>Approve</button><button className="btn-danger h-8" onClick={() => act(api.del(`/comments/${c.id}`))}>Delete</button></div>
      </li>
    ))}</ul>
  );
}

function Filters() {
  const q = useQuery({ queryKey: ['mod', 'filters'], queryFn: () => api.get<{ pattern: string; action: string }[]>('/mod/filters') });
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState('hide');
  const toast = useToast();
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-3">Case-insensitive regular expressions checked against new posts. <b>Hide</b> holds the post for review; <b>Block</b> rejects it.</p>
      <div className="flex gap-2 mb-4"><input className="input font-mono" placeholder="e.g. \bbuy followers\b" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <Select className="w-28" value={action} onChange={setAction} options={[{ value: 'hide', label: 'Hide' }, { value: 'block', label: 'Block' }]} />
        <button className="btn-primary" onClick={() => api.post('/mod/filters', { pattern, action }).then(() => { setPattern(''); q.refetch(); }).catch((e) => toast(e.message, 'error'))}>Add</button></div>
      <ul className="card divide-y divide-border/60">{q.data?.map((f) => (
        <li key={f.pattern} className="flex items-center gap-3 p-2.5 text-sm"><code className="flex-1">{f.pattern}</code><span className="text-xs text-muted">{f.action}</span>
          <button className="btn-ghost h-7 text-danger" onClick={() => api.del(`/mod/filters?pattern=${encodeURIComponent(f.pattern)}`).then(() => q.refetch())}>Remove</button></li>
      ))}{!q.data?.length && <li className="p-3 text-sm text-muted">No filters.</li>}</ul>
    </div>
  );
}

function Users({ admin, suspended, onChange }: { admin: boolean; suspended: any[]; onChange: () => void }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('moderator');
  const toast = useToast();
  return (
    <div className="max-w-2xl space-y-6">
      {admin && (
        <div className="card p-4"><h3 className="font-medium mb-2">Roles</h3>
          <div className="flex gap-2"><input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Select className="w-36" value={role} onChange={setRole} options={[{ value: 'user', label: 'User' }, { value: 'moderator', label: 'Moderator' }, { value: 'admin', label: 'Admin' }]} />
            <button className="btn-primary" onClick={() => api.post(`/mod/users/${username}/role`, { role }).then(() => toast('Role updated', 'success')).catch((e) => toast(e.message, 'error'))}>Apply</button></div></div>
      )}
      <div><h3 className="font-medium mb-2">Suspended</h3>
        {!suspended.length ? <p className="text-sm text-muted">No suspended users.</p> : <ul className="card divide-y divide-border/60">{suspended.map((u) => (
          <li key={u.id} className="flex items-center gap-3 p-2.5 text-sm"><Avatar user={u} size={26} /><span className="flex-1">{u.displayName} @{u.username} · until {new Date(u.until).toLocaleDateString()}</span>
            <button className="btn-outline h-8" onClick={() => api.post(`/mod/users/${u.username}/unsuspend`).then(onChange)}>Lift</button></li>
        ))}</ul>}
      </div>
    </div>
  );
}

function Emoji() {
  const q = useQuery({ queryKey: ['emoji'], queryFn: () => api.get<{ name: string; url: string }[]>('/emoji') });
  const [name, setName] = useState('');
  const toast = useToast();
  const add = async (f?: File) => {
    if (!f || !/^[a-z0-9_]{2,32}$/.test(name)) return toast('Pick a name (a–z, 0–9, _) first', 'error');
    try { const { url } = await api.upload(f); await api.post('/emoji', { name, url }); setName(''); q.refetch(); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-3">Custom emoji can be used in chat as <code>:name:</code>.</p>
      <div className="flex gap-2 mb-4"><input className="input" placeholder="name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /><label className="btn-primary cursor-pointer">Upload image<input type="file" accept="image/*" className="hidden" onChange={(e) => add(e.target.files?.[0])} /></label></div>
      <div className="flex flex-wrap gap-3">{q.data?.map((e) => (
        <div key={e.name} className="card p-2 flex items-center gap-2 text-sm"><img src={e.url} alt="" className="h-6 w-6" />:{e.name}:<button className="text-muted hover:text-danger" onClick={() => api.del(`/emoji/${e.name}`).then(() => q.refetch())} aria-label={`Delete ${e.name}`}>×</button></div>
      ))}</div>
    </div>
  );
}

function Log() {
  const q = useQuery({ queryKey: ['mod', 'log'], queryFn: () => api.get<any[]>('/mod/log') });
  if (q.isLoading) return <Spinner />;
  return (
    <ul className="card divide-y divide-border/60 text-sm">{q.data?.map((l) => <li key={l.id} className="p-2.5"><b>{l.username}</b> {l.action.replace('_', ' ')} {l.target_type} <code className="text-xs">{l.target_id}</code>{l.details && <span className="text-muted"> — {l.details}</span>}<span className="text-xs text-muted float-right">{timeAgo(l.created_at)}</span></li>)}
      {!q.data?.length && <li className="p-3 text-muted">No moderator actions yet.</li>}</ul>
  );
}

function Announce() {
  const [f, setF] = useState({ title: '', body: '', link: '' });
  const toast = useToast();
  return (
    <div className="max-w-xl space-y-3">
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className="textarea" rows={4} placeholder="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <input className="input" placeholder="Link (optional, e.g. /guidelines)" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
      <button className="btn-primary" disabled={!f.title} onClick={() => confirm('Send this announcement to every member?') && api.post('/mod/announce', { ...f, link: f.link || undefined }).then((r) => { toast(`Sent to ${r.sent} members`, 'success'); setF({ title: '', body: '', link: '' }); })}>Send to everyone</button>
    </div>
  );
}
