import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, GripVertical, Heart, Pencil, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { TYPE_LABEL, cls, timeAgo } from '@/lib/format';
import type { ListDTO } from '@/lib/types';
import { Avatar, Cover, ErrorState, Modal, PageLoader, RichText, UserLink } from '@/components/ui';
import { ReportButton, titleHref } from '@/components/titles';
import { Comments } from '@/components/comments';
import { ListForm } from './Lists';

type Item = NonNullable<ListDTO['items']>[number];

export default function ListPage() {
  const id = useParams().id!;
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['list', id], queryFn: () => api.get<ListDTO>(`/lists/${enc(id)}`) });
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => setItems(q.data?.items ?? []), [q.data]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const l = q.data!;
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(items, items.findIndex((i) => i.title.id === e.active.id), items.findIndex((i) => i.title.id === e.over!.id));
    setItems(next);
    try { await api.put(`/lists/${l.id}/order`, { titleIds: next.map((i) => i.title.id) }); } catch (err: any) { toast(err.message, 'error'); q.refetch(); }
  };
  const remove = async (titleId: string) => { await api.del(`/lists/${l.id}/items/${enc(titleId)}`); q.refetch(); };
  const shareUrl = `${location.origin}/lists/${l.visibility === 'private' ? l.id : l.slug}`;

  return (
    <div className="max-w-4xl mx-auto">
      {l.coverUrl && !l.previews.includes(l.coverUrl) && <img src={l.coverUrl} alt="" className="w-full h-40 sm:h-56 object-cover rounded-xl mb-5" />}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted uppercase tracking-wide">{l.visibility} list{l.collaborative && ' · collaborative'}</p>
          <h1 className="font-display text-3xl font-bold mt-1">{l.name}</h1>
          <div className="flex items-center gap-2 mt-2 text-sm"><Avatar user={l.owner} size={22} /><UserLink user={l.owner} /><span className="text-muted">· {l.itemCount} titles · updated {timeAgo(l.updatedAt)}</span></div>
          {l.description && <p className="mt-3 text-sm text-fg/90"><RichText text={l.description} /></p>}
          {!!l.members?.length && <div className="flex items-center gap-1.5 mt-3 text-xs text-muted"><Users className="h-3.5 w-3.5" />With {l.members.filter((m) => m.accepted).map((m) => m.displayName).join(', ') || 'pending invites'}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {user && !l.isOwner && <button className={cls('btn-outline', l.liked && 'text-accent border-accent/50')} onClick={() => api.post(`/lists/${l.id}/like`).then(() => q.refetch())}><Heart className={cls('h-4 w-4', l.liked && 'fill-current')} />{l.likes}</button>}
          <button className="btn-outline" onClick={() => setSharing(true)}><Copy className="h-4 w-4" />Share</button>
          {l.isOwner && <button className="btn-outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</button>}
          {l.isOwner && <button className="btn-icon" aria-label="Delete list" onClick={async () => { if (confirm(`Delete “${l.name}”?`)) { await api.del(`/lists/${l.id}`); nav('/lists'); } }}><Trash2 className="h-4 w-4" /></button>}
          {!l.isOwner && <ReportButton targetType="list" targetId={l.id} />}
        </div>
      </div>

      {!items.length ? <p className="text-sm text-muted card p-6">This list is empty. {l.canEdit && 'Add titles from any title page with “Add to list”.'}</p> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.title.id)} strategy={verticalListSortingStrategy} disabled={!l.canEdit}>
            <ol className="space-y-2">{items.map((it, i) => <Row key={it.title.id} it={it} n={i + 1} canEdit={l.canEdit} onRemove={() => remove(it.title.id)} listId={l.id} />)}</ol>
          </SortableContext>
        </DndContext>
      )}
      {l.canEdit && items.length > 1 && <p className="text-xs text-muted mt-2">Drag the handle to reorder.</p>}

      {l.visibility !== 'private' && <div className="mt-10"><Comments targetType="list" targetId={l.id} canPin={l.isOwner} /></div>}

      {editing && <ListForm open onClose={() => { setEditing(false); q.refetch(); }} list={l} />}
      <Modal open={sharing} onClose={() => setSharing(false)} title="Share list">
        <div className="space-y-4">
          {l.visibility === 'private' && <p className="text-sm text-warning">This list is private. Change visibility to “Anyone with link” or “Public” to share it.</p>}
          <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={shareUrl} onFocus={(e) => e.target.select()} /><button className="btn-primary" onClick={() => navigator.clipboard.writeText(shareUrl).then(() => toast('Link copied', 'success'))}>Copy</button></div>
          {l.isOwner && l.visibility !== 'private' && <button className="btn-ghost text-sm" onClick={() => api.post(`/lists/${l.id}/regenerate-link`).then(() => { q.refetch(); toast('New link created; the old one no longer works.', 'success'); })}><RefreshCw className="h-4 w-4" />Regenerate link</button>}
          {l.isOwner && <Collaborators list={l} onChange={() => q.refetch()} />}
        </div>
      </Modal>
    </div>
  );
}

function Row({ it, n, canEdit, onRemove, listId }: { it: Item; n: number; canEdit: boolean; onRemove: () => void; listId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.title.id });
  const [note, setNote] = useState(it.note);
  const [editingNote, setEditingNote] = useState(false);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cls('card p-2.5 flex items-center gap-3', isDragging && 'shadow-card z-10 relative')}>
      {canEdit && <button className="btn-icon h-8 w-6 cursor-grab touch-none" {...attributes} {...listeners} aria-label={`Reorder ${it.title.title}`}><GripVertical className="h-4 w-4" /></button>}
      <span className="w-6 text-center font-display text-muted tabular-nums">{n}</span>
      <Link to={titleHref(it.title)} className="shrink-0"><Cover src={it.title.coverUrl} alt={it.title.title} className="w-12" /></Link>
      <div className="flex-1 min-w-0">
        <Link to={titleHref(it.title)} className="font-medium hover:text-primary line-clamp-1">{it.title.title}</Link>
        <div className="text-xs text-muted">{TYPE_LABEL[it.title.type]}{it.title.year ? ` · ${it.title.year}` : ''}{it.title.genres.length ? ` · ${it.title.genres.slice(0, 3).join(', ')}` : ''}</div>
        {editingNote ? (
          <input className="input h-8 mt-1 text-xs" autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} onBlur={() => { setEditingNote(false); api.patch(`/lists/${listId}/items/${enc(it.title.id)}`, { note }); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        ) : note ? <p className="text-sm mt-1 italic text-fg/80" onClick={() => canEdit && setEditingNote(true)}>{note}</p> : canEdit && <button className="text-xs text-muted hover:text-fg mt-1" onClick={() => setEditingNote(true)}>+ Add a note</button>}
      </div>
      {canEdit && <button className="btn-icon" onClick={onRemove} aria-label={`Remove ${it.title.title}`}><X className="h-4 w-4" /></button>}
    </li>
  );
}

function Collaborators({ list, onChange }: { list: ListDTO; onChange: () => void }) {
  const [username, setUsername] = useState('');
  const toast = useToast();
  const invite = async () => {
    try { await api.post(`/lists/${list.id}/members`, { username }); setUsername(''); onChange(); toast('Invite sent', 'success'); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="border-t border-border pt-4">
      <div className="text-sm font-medium mb-2">Collaborators</div>
      <ul className="space-y-1.5 mb-3">{list.members?.map((m) => (
        <li key={m.id} className="flex items-center gap-2 text-sm"><Avatar user={m} size={24} /><span className="flex-1">{m.displayName}{!m.accepted && <span className="text-xs text-muted"> · invited</span>}</span>
          <button className="btn-icon h-7 w-7" onClick={() => api.del(`/lists/${list.id}/members/${m.id}`).then(onChange)} aria-label={`Remove ${m.displayName}`}><X className="h-3.5 w-3.5" /></button></li>
      ))}</ul>
      <div className="flex gap-2"><input className="input" placeholder="Friend's username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} /><button className="btn-outline" onClick={invite}><UserPlus className="h-4 w-4" />Invite</button></div>
      <p className="text-xs text-muted mt-1">Only friends can be invited.</p>
    </div>
  );
}
