import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, ChevronDown, Flag, Heart, ListPlus, Plus, Star } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, cls, num } from '@/lib/format';
import type { Entry, ListDTO, Status, Title } from '@/lib/types';
import { useAuth, useToast } from '@/hooks/app';
import { Cover, Menu, MenuItem, Modal, Select, Stars, Spinner } from './ui';

export const titleHref = (t: Pick<Title, 'id'>) => `/title/${enc(t.id)}`;

export function TitleCard({ title, subtitle, badge, size = 'md', footer }: { title: Title; subtitle?: ReactNode; badge?: ReactNode; size?: 'sm' | 'md' | 'lg'; footer?: ReactNode }) {
  return (
    <Link to={titleHref(title)} className="group block min-w-0" title={title.title}>
      <div className="relative">
        <Cover src={title.coverUrl} alt={title.title} className="shadow-card transition-transform group-hover:-translate-y-0.5" />
        <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-black/65 text-white backdrop-blur-sm">{TYPE_LABEL[title.type] ?? title.type}</span>
        {badge && <span className="absolute top-1.5 right-1.5">{badge}</span>}
      </div>
      <div className={cls('mt-2 font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors', size === 'sm' ? 'text-xs' : 'text-sm')}>{title.title}</div>
      {subtitle !== undefined ? <div className="text-xs text-muted mt-0.5 truncate">{subtitle}</div> : (
        <div className="text-xs text-muted mt-0.5 truncate">
          {title.sourceRating ? <span className="inline-flex items-center gap-0.5 mr-2"><Star className="h-3 w-3 fill-warning text-warning" />{title.sourceRating.toFixed(1)}</span> : null}
          {title.year ?? ''}{title.status ? ` · ${title.status}` : ''}
        </div>
      )}
      {footer}
    </Link>
  );
}

const GRID: Record<string, string> = {
  sm: 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9',
  md: 'grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7',
  lg: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
};
export function TitleGrid({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return <div className={cls('grid gap-x-[var(--gap)] gap-y-5', GRID[size])}>{children}</div>;
}
export function TitleRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-[var(--gap)] overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 snap-x [&>*]:snap-start [&>*]:shrink-0 [&>*]:w-[120px] sm:[&>*]:w-[140px]">{children}</div>;
}
export function GridSkeleton({ n = 12, row }: { n?: number; row?: boolean }) {
  const items = Array.from({ length: n }, (_, i) => <div key={i}><div className="skeleton aspect-[2/3]" /><div className="skeleton h-3 mt-2 w-4/5" /></div>);
  return row ? <TitleRow>{items}</TitleRow> : <TitleGrid>{items}</TitleGrid>;
}

/** Status dropdown + "edit entry" modal. Works for any title id (loads the title server-side). */
export function LibraryButton({ title, entry, compact }: { title: Title; entry: Entry | null; compact?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (patch: Partial<Entry>) => api.put<{ entry: Entry }>(`/library/${enc(title.id)}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['title', title.id] });
      qc.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/library/${enc(title.id)}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['title', title.id] }); qc.invalidateQueries({ queryKey: ['library'] }); toast('Removed from library'); },
  });
  if (!user) return <button className="btn-primary" onClick={() => nav('/login')}><Plus className="h-4 w-4" />Add to library</button>;
  return (
    <>
      <div className="inline-flex rounded overflow-hidden">
        <Menu align="left" trigger={() => (
          <button className={cls(entry ? 'btn bg-primary/15 text-fg border border-primary/40 hover:bg-primary/25 rounded-r-none' : 'btn-primary rounded-r-none')} disabled={save.isPending}>
            {save.isPending ? <Spinner className="h-4 w-4" /> : entry ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
            {entry ? STATUS_LABEL[entry.status] : compact ? 'Add' : 'Add to library'}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </button>
        )}>
          {(close) => (
            <>
              {STATUS_ORDER.map((s) => <MenuItem key={s} active={entry?.status === s} onClick={() => { save.mutate({ status: s }); close(); }}>{STATUS_LABEL[s]}</MenuItem>)}
              {entry && <><div className="my-1 border-t border-border" /><MenuItem onClick={() => { setEditing(true); close(); }}>Edit details…</MenuItem>
                <MenuItem danger onClick={() => { remove.mutate(); close(); }}>Remove from library</MenuItem></>}
            </>
          )}
        </Menu>
        <button aria-label={entry?.favorite ? 'Unfavorite' : 'Favorite'} aria-pressed={!!entry?.favorite} onClick={() => save.mutate({ favorite: !entry?.favorite })}
          className={cls('btn rounded-l-none border-l border-black/10 px-2.5', entry ? 'bg-primary/15 border border-primary/40 hover:bg-primary/25' : 'bg-primary text-on-primary hover:brightness-110')}>
          <Heart className={cls('h-4 w-4', entry?.favorite && 'fill-accent text-accent')} />
        </button>
      </div>
      {editing && entry && <EntryEditor title={title} entry={entry} onClose={() => setEditing(false)} onSave={(p) => save.mutateAsync(p).then(() => setEditing(false))} />}
    </>
  );
}

function EntryEditor({ title, entry, onClose, onSave }: { title: Title; entry: Entry; onClose: () => void; onSave: (p: Partial<Entry>) => Promise<unknown> }) {
  const [e, setE] = useState(entry);
  const [tag, setTag] = useState('');
  const meta = useQuery({ queryKey: ['library-meta'], queryFn: () => api.get<{ tags: string[]; shelves: string[] }>('/library/meta') });
  const addTag = () => { const t = tag.trim(); if (t && !e.tags.includes(t)) setE({ ...e, tags: [...e.tags, t] }); setTag(''); };
  return (
    <Modal open onClose={onClose} title={title.title} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onSave({ status: e.status, progressChapter: e.progressChapter, progressVolume: e.progressVolume, rating: e.rating, notes: e.notes, tags: e.tags, notify: e.notify, shelf: e.shelf || null })}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><span className="label">Status</span><Select value={e.status} onChange={(v: Status) => setE({ ...e, status: v })} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></div>
        <label><span className="label">Chapter progress{title.chapterCount ? ` / ${title.chapterCount}` : ''}</span><input type="number" min={0} step="any" className="input" value={e.progressChapter} onChange={(x) => setE({ ...e, progressChapter: Number(x.target.value) })} /></label>
        <label><span className="label">Volume progress</span><input type="number" min={0} className="input" value={e.progressVolume} onChange={(x) => setE({ ...e, progressVolume: Number(x.target.value) })} /></label>
        <div className="col-span-2"><span className="label">Your rating</span><Stars value={e.rating} onChange={(v) => setE({ ...e, rating: v })} /></div>
        <div className="col-span-2">
          <span className="label">Custom tags</span>
          <div className="flex flex-wrap gap-1.5 mb-2">{e.tags.map((t) => <button key={t} className="chip-on" onClick={() => setE({ ...e, tags: e.tags.filter((x) => x !== t) })}>{t} ×</button>)}</div>
          <div className="flex gap-2"><input className="input" list="tag-suggestions" placeholder="Add a tag" value={tag} onChange={(x) => setTag(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && (x.preventDefault(), addTag())} /><button className="btn-outline" onClick={addTag}>Add</button></div>
          <datalist id="tag-suggestions">{meta.data?.tags.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <label className="col-span-2"><span className="label">Bookshelf</span><input className="input" list="shelf-suggestions" placeholder="e.g. Comfort reads" value={e.shelf ?? ''} onChange={(x) => setE({ ...e, shelf: x.target.value })} />
          <datalist id="shelf-suggestions">{meta.data?.shelves.map((t) => <option key={t} value={t} />)}</datalist></label>
        <label className="col-span-2"><span className="label">Notes</span><textarea className="textarea" rows={3} value={e.notes} onChange={(x) => setE({ ...e, notes: x.target.value })} /></label>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={e.notify} onChange={(x) => setE({ ...e, notify: x.target.checked })} /> Notify me about new chapters</label>
      </div>
    </Modal>
  );
}

export function AddToListButton({ title }: { title: Title }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <button className="btn-outline" onClick={() => setOpen(true)}><ListPlus className="h-4 w-4" /><span className="hidden sm:inline">Add to list</span></button>
      {open && <AddToListModal title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddToListModal({ title, onClose }: { title: Title; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lists = useQuery({ queryKey: ['lists', 'mine'], queryFn: () => api.get<ListDTO[]>('/lists/mine') });
  const containing = useQuery({ queryKey: ['lists', 'containing', title.id], queryFn: () => api.get<string[]>(`/lists/containing/${enc(title.id)}`) });
  const [name, setName] = useState('');
  const toggle = async (l: ListDTO) => {
    const has = containing.data?.includes(l.id);
    try {
      if (has) await api.del(`/lists/${l.id}/items/${enc(title.id)}`);
      else await api.post(`/lists/${l.id}/items`, { titleId: title.id });
      qc.invalidateQueries({ queryKey: ['lists'] });
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const create = async () => {
    if (!name.trim()) return;
    const l = await api.post<ListDTO>('/lists', { name: name.trim() });
    await api.post(`/lists/${l.id}/items`, { titleId: title.id });
    setName('');
    qc.invalidateQueries({ queryKey: ['lists'] });
    toast(`Added to “${l.name}”`, 'success');
  };
  return (
    <Modal open onClose={onClose} title="Add to list">
      <div className="space-y-1 max-h-72 overflow-y-auto -mx-2">
        {lists.isLoading && <Spinner />}
        {lists.data?.filter((l) => l.canEdit).map((l) => (
          <button key={l.id} onClick={() => toggle(l)} className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-hover/[0.06] text-left">
            <span className={cls('h-5 w-5 rounded border flex items-center justify-center', containing.data?.includes(l.id) ? 'bg-primary border-primary text-on-primary' : 'border-border')}>
              {containing.data?.includes(l.id) && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="flex-1 text-sm">{l.name}</span><span className="text-xs text-muted">{l.itemCount}</span>
          </button>
        ))}
        {lists.data?.length === 0 && <p className="text-sm text-muted px-2">No lists yet — create your first one below.</p>}
      </div>
      <div className="flex gap-2 mt-4"><input className="input" placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /><button className="btn-primary" onClick={create}>Create</button></div>
    </Modal>
  );
}

export function ReportButton({ targetType, targetId, className = '', label }: { targetType: string; targetId: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const toast = useToast();
  const { user } = useAuth();
  if (!user) return null;
  const submit = async () => {
    try {
      await api.post('/reports', { targetType, targetId, reason, details });
      toast('Thanks — a moderator will review this.', 'success');
      setOpen(false);
    } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <>
      <button className={cls('inline-flex items-center gap-1 text-xs text-muted hover:text-danger', className)} onClick={() => setOpen(true)}><Flag className="h-3.5 w-3.5" />{label ?? 'Report'}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report" footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-danger" onClick={submit}>Submit report</button></>}>
        <div className="space-y-3">
          <Select value={reason} onChange={setReason} label="Reason" options={[
            { value: 'spam', label: 'Spam' }, { value: 'harassment', label: 'Harassment or bullying' }, { value: 'spoiler', label: 'Unmarked spoiler' },
            { value: 'hate', label: 'Hate speech' }, { value: 'nsfw', label: 'Inappropriate content' }, { value: 'impersonation', label: 'Impersonation' }, { value: 'other', label: 'Something else' },
          ]} />
          <textarea className="textarea" rows={3} placeholder="Anything moderators should know? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          <p className="text-xs text-muted">See the <Link to="/guidelines" className="link">community guidelines</Link>.</p>
        </div>
      </Modal>
    </>
  );
}

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="card p-4 min-w-0">
    <div className="text-xs text-muted">{label}</div>
    <div className="font-display text-2xl font-semibold mt-1 tabular-nums truncate">{value}</div>
    {sub && <div className="text-xs text-muted mt-0.5 truncate">{sub}</div>}
  </div>
);
export { num };
