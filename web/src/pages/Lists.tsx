import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Globe, Link2, ListPlus, Lock, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/app';
import type { ListDTO } from '@/lib/types';
import { Empty, ErrorState, Modal, Segmented, Spinner, Tabs, Toggle } from '@/components/ui';

export function ListCard({ l }: { l: ListDTO }) {
  const Icon = l.visibility === 'public' ? Globe : l.visibility === 'unlisted' ? Link2 : Lock;
  return (
    <Link to={`/lists/${l.id}`} className="card p-3 hover:border-primary/50 transition-colors group block">
      <div className="relative h-36 rounded overflow-hidden bg-surface-2 flex">
        {l.coverUrl && !l.previews.includes(l.coverUrl) ? <img src={l.coverUrl} alt="" className="h-full w-full object-cover" /> : l.previews.length ? (
          l.previews.slice(0, 4).map((p, i) => <img key={i} src={p ?? ''} alt="" className="h-full flex-1 object-cover min-w-0" loading="lazy" />)
        ) : <div className="m-auto text-muted text-xs">Empty list</div>}
      </div>
      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate group-hover:text-primary">{l.name}</div>
          <div className="text-xs text-muted truncate">{l.itemCount} titles · by {l.owner.displayName}{l.likes ? ` · ♥ ${l.likes}` : ''}</div>
        </div>
        <Icon className="h-4 w-4 text-muted shrink-0" aria-label={l.visibility} />
        {l.collaborative && <Users className="h-4 w-4 text-muted shrink-0" aria-label="Collaborative" />}
      </div>
    </Link>
  );
}

export default function Lists() {
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [open, setOpen] = useState(false);
  const mine = useQuery({ queryKey: ['lists', 'mine'], queryFn: () => api.get<ListDTO[]>('/lists/mine') });
  const invites = useQuery({ queryKey: ['lists', 'invites'], queryFn: () => api.get<ListDTO[]>('/lists/invites') });
  const pub = useQuery({ queryKey: ['lists', 'public'], enabled: tab === 'public', queryFn: () => api.get<ListDTO[]>('/lists/public') });
  const data = tab === 'mine' ? mine : pub;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-bold">Lists</h1>
        <button className="btn-primary" onClick={() => setOpen(true)}><ListPlus className="h-4 w-4" />New list</button>
      </div>
      {!!invites.data?.length && (
        <div className="panel p-3 mb-5 space-y-2">
          <div className="text-sm font-medium">Collaboration invites</div>
          {invites.data.map((l) => (
            <div key={l.id} className="flex items-center gap-3 text-sm"><span className="flex-1"><b>{l.owner.displayName}</b> invited you to “{l.name}”</span>
              <button className="btn-primary h-8" onClick={() => api.post(`/lists/${l.id}/members/respond`, { accept: true }).then(() => { invites.refetch(); mine.refetch(); })}>Accept</button>
              <button className="btn-ghost h-8" onClick={() => api.post(`/lists/${l.id}/members/respond`, { accept: false }).then(() => invites.refetch())}>Decline</button></div>
          ))}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'My lists' }, { id: 'public', label: 'Community lists' }]} className="mb-5" />
      {data.isLoading ? <Spinner /> : data.error ? <ErrorState error={data.error} retry={data.refetch} /> : !data.data?.length ? (
        <Empty icon={<ListPlus />} title={tab === 'mine' ? 'No lists yet' : 'No public lists yet'} action={tab === 'mine' && <button className="btn-primary" onClick={() => setOpen(true)}>Create your first list</button>}>
          {tab === 'mine' && 'Favorite Romance Manga, Hidden Gems, Best Psychological Thrillers… make as many as you like.'}
        </Empty>
      ) : <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{data.data.map((l) => <ListCard key={l.id} l={l} />)}</div>}
      <ListForm open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function ListForm({ open, onClose, list }: { open: boolean; onClose: () => void; list?: ListDTO }) {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ name: list?.name ?? '', description: list?.description ?? '', visibility: list?.visibility ?? 'private', collaborative: list?.collaborative ?? false, coverUrl: list?.coverUrl ?? null as string | null });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (list) { await api.patch(`/lists/${list.id}`, f); onClose(); }
      else { const l = await api.post<ListDTO>('/lists', f); nav(`/lists/${l.id}`); }
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    try { const r = await api.upload(file); setF({ ...f, coverUrl: r.url }); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <Modal open={open} onClose={onClose} title={list ? 'Edit list' : 'New list'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.name.trim() || busy} onClick={save}>{list ? 'Save' : 'Create'}</button></>}>
      <div className="space-y-3">
        <label className="block"><span className="label">Name</span><input className="input" autoFocus maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Hidden Gems" /></label>
        <label className="block"><span className="label">Description</span><textarea className="textarea" rows={3} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div><span className="label">Visibility</span><Segmented value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} options={[{ value: 'private', label: 'Private' }, { value: 'unlisted', label: 'Anyone with link' }, { value: 'public', label: 'Public' }]} /></div>
        <Toggle label="Collaborative" description="Invite friends to add and reorder titles." checked={f.collaborative} onChange={(v) => setF({ ...f, collaborative: v })} />
        <div>
          <span className="label">Cover image</span>
          <div className="flex items-center gap-3">
            {f.coverUrl && <img src={f.coverUrl} alt="" className="h-14 w-24 object-cover rounded" />}
            <label className="btn-outline cursor-pointer">Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
            {f.coverUrl && <button className="btn-ghost" onClick={() => setF({ ...f, coverUrl: null })}>Use title covers</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
