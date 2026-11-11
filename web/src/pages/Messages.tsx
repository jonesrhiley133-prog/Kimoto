import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, Image as ImageIcon, LogOut, MessageSquarePlus, MoreVertical, Pencil, Reply, Search, Send, Smile, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { setUnreadCounts, useAuth, useToast } from '@/hooks/app';
import { cls, timeAgo } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import type { Conversation, Message, MiniUser } from '@/lib/types';
import { Avatar, Empty, Menu, MenuItem, Modal, Spinner, Tabs, useDebounced } from '@/components/ui';
import { ReportButton } from '@/components/titles';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export default function Messages() {
  const id = useParams().id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'chats' | 'requests'>(params.get('tab') === 'requests' ? 'requests' : 'chats');
  const [creating, setCreating] = useState(false);
  const { user: me } = useAuth();
  const convs = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/messages/conversations') });

  // Open a DM via ?to=username (from profiles / friends list).
  useEffect(() => {
    const to = params.get('to');
    if (!to) return;
    api.post<Conversation>('/messages/conversations', { usernames: [to] }).then((c) => { qc.invalidateQueries({ queryKey: ['conversations'] }); nav(`/messages/${c.id}`, { replace: true }); }).catch((e) => toast(e.message, 'error'));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['conversations'] });
    s.on('message', refresh); s.on('conversation:new', refresh); s.on('conversation:updated', refresh); s.on('presence', refresh);
    return () => { s.off('message', refresh); s.off('conversation:new', refresh); s.off('conversation:updated', refresh); s.off('presence', refresh); };
  }, [qc]);

  useEffect(() => {
    if (convs.data) setUnreadCounts({ messages: convs.data.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0) });
  }, [convs.data]);

  const active = convs.data?.find((c) => c.id === id);
  return (
    <div className="-my-5 -mx-4 md:mx-0 md:my-0 h-[calc(100dvh-3.5rem-3.5rem)] md:h-[calc(100dvh-3.5rem-2.5rem)] flex md:card overflow-hidden">
      <aside className={cls('w-full md:w-80 md:border-r border-border flex flex-col shrink-0', id && 'hidden md:flex')}>
        <div className="p-3 flex items-center gap-2 border-b border-border">
          <h1 className="font-display font-semibold text-lg flex-1">Messages</h1>
          <button className="btn-icon" onClick={() => setCreating(true)} aria-label="New conversation"><MessageSquarePlus className="h-5 w-5" /></button>
        </div>
        <Tabs value={tab} onChange={setTab} className="px-2" tabs={[{ id: 'chats', label: 'Chats' }, { id: 'requests', label: 'Friend requests' }]} />
        {tab === 'requests' ? <Requests /> : (
          <div className="flex-1 overflow-y-auto">
            <SearchBox />
            {convs.isLoading ? <div className="p-4"><Spinner /></div> : !convs.data?.length ? <p className="text-sm text-muted p-4">No conversations yet.</p> : convs.data.map((c) => {
              const other = c.kind === 'dm' ? c.members.find((m) => m.id !== me?.id) ?? c.members[0] : null;
              const online = !!other?.presence.online;
              return (
                <Link key={c.id} to={`/messages/${c.id}`} className={cls('flex items-center gap-3 px-3 py-2.5 hover:bg-hover/[0.04]', c.id === id && 'bg-selected/10')}>
                  <span className="relative shrink-0">{c.kind === 'group' ? <span className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center"><Users className="h-5 w-5 text-muted" /></span> : <Avatar user={{ ...other, displayName: c.name, avatarUrl: c.iconUrl } as any} size={40} />}
                    {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-success ring-2 ring-surface" />}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className={cls('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{c.name}</span>{c.muted && <BellOff className="h-3 w-3 text-muted" />}<span className="ml-auto text-[11px] text-muted shrink-0">{c.lastMessage && timeAgo(c.lastMessage.createdAt)}</span></div>
                    <div className="flex items-center gap-2"><span className={cls('text-xs truncate flex-1', c.unread ? 'text-fg' : 'text-muted')}>{c.lastMessage?.body ?? 'No messages yet'}</span>{c.unread > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center">{c.unread}</span>}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </aside>
      <section className={cls('flex-1 min-w-0 flex flex-col', !id && 'hidden md:flex')}>
        {id ? (active ? <Chat key={id} conv={active} /> : convs.isLoading ? <div className="m-auto"><Spinner /></div> : <div className="m-auto text-sm text-muted">Conversation not found.</div>)
          : <div className="m-auto"><Empty icon={<MessageSquarePlus />} title="Your messages" action={<button className="btn-primary" onClick={() => setCreating(true)}>Start a conversation</button>}>Chat privately or start a group with friends.</Empty></div>}
      </section>
      {creating && <NewConversation onClose={() => setCreating(false)} />}
    </div>
  );
}

function SearchBox() {
  const [s, setS] = useState('');
  const ds = useDebounced(s, 300);
  const q = useQuery({ queryKey: ['msg-search', ds], enabled: ds.length >= 2, queryFn: () => api.get<(Message & { author: string })[]>(`/messages/search?q=${enc(ds)}`) });
  return (
    <div className="p-2">
      <div className="relative"><Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-8 h-8" placeholder="Search messages" value={s} onChange={(e) => setS(e.target.value)} /></div>
      {ds.length >= 2 && <div className="mt-1 panel max-h-64 overflow-y-auto">{q.isLoading ? <div className="p-2"><Spinner /></div> : !q.data?.length ? <p className="text-xs text-muted p-2">No matches</p> : q.data.map((m) => (
        <Link key={m.id} to={`/messages/${m.conversationId}`} onClick={() => setS('')} className="block px-2 py-1.5 hover:bg-hover/[0.05] text-xs"><b>{m.author}</b> <span className="text-muted">{timeAgo(m.createdAt)}</span><div className="truncate">{m.body}</div></Link>
      ))}</div>}
    </div>
  );
}

function Requests() {
  const q = useQuery({ queryKey: ['friends'], queryFn: () => api.get<{ incoming: MiniUser[]; outgoing: MiniUser[] }>('/friends') });
  if (q.isLoading) return <div className="p-4"><Spinner /></div>;
  if (!q.data?.incoming.length) return <p className="text-sm text-muted p-4">No pending friend requests.</p>;
  return (
    <ul className="p-2">{q.data.incoming.map((u) => (
      <li key={u.id} className="flex items-center gap-2 p-2"><Avatar user={u} size={34} /><Link to={`/u/${u.username}`} className="flex-1 text-sm font-medium truncate">{u.displayName}</Link>
        <button className="btn-primary h-8 px-2.5" onClick={() => api.post(`/u/${u.username}/friend/respond`, { accept: true }).then(() => q.refetch())} aria-label="Accept"><Check className="h-4 w-4" /></button>
        <button className="btn-ghost h-8 px-2.5" onClick={() => api.post(`/u/${u.username}/friend/respond`, { accept: false }).then(() => q.refetch())} aria-label="Decline"><X className="h-4 w-4" /></button></li>
    ))}</ul>
  );
}

function NewConversation({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.get<{ friends: MiniUser[] }>('/friends') });
  const [s, setS] = useState('');
  const ds = useDebounced(s, 300);
  const search = useQuery({ queryKey: ['user-search', ds], enabled: ds.length >= 2, queryFn: () => api.get<MiniUser[]>(`/users/search?q=${enc(ds)}`) });
  const [picked, setPicked] = useState<MiniUser[]>([]);
  const [name, setName] = useState('');
  const pool = ds.length >= 2 ? search.data ?? [] : friends.data?.friends ?? [];
  const create = async () => {
    try {
      const c = await api.post<Conversation>('/messages/conversations', { usernames: picked.map((p) => p.username), name: picked.length > 1 ? name || undefined : undefined });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
      nav(`/messages/${c.id}`);
    } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="New conversation" footer={<button className="btn-primary" disabled={!picked.length} onClick={create}>{picked.length > 1 ? 'Create group' : 'Start chat'}</button>}>
      <div className="flex flex-wrap gap-1.5 mb-2">{picked.map((p) => <span key={p.id} className="chip-on">{p.displayName}<button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.displayName}`}>×</button></span>)}</div>
      <input className="input" autoFocus placeholder="Search people" value={s} onChange={(e) => setS(e.target.value)} />
      {picked.length > 1 && <input className="input mt-2" placeholder="Group name (optional)" value={name} onChange={(e) => setName(e.target.value)} />}
      <ul className="mt-2 max-h-64 overflow-y-auto">{pool.filter((u) => !picked.some((p) => p.id === u.id)).map((u) => (
        <li key={u.id}><button className="w-full flex items-center gap-2 p-2 rounded hover:bg-hover/[0.05] text-left" onClick={() => setPicked([...picked, u])}><Avatar user={u} size={28} /><span className="text-sm">{u.displayName} <span className="text-muted">@{u.username}</span></span></button></li>
      ))}</ul>
      {!ds && !friends.data?.friends.length && <p className="text-xs text-muted mt-2">Search for anyone by username.</p>}
    </Modal>
  );
}

function Chat({ conv }: { conv: Conversation }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [reads, setReads] = useState<Record<string, string | null>>(() => Object.fromEntries(conv.members.map((m) => [m.id, m.lastReadAt])));
  const [gif, setGif] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const emoji = useQuery({ queryKey: ['emoji'], queryFn: () => api.get<{ name: string; url: string }[]>('/emoji'), staleTime: 3600_000 });
  const emojiMap = useMemo(() => new Map((emoji.data ?? []).map((e) => [e.name, e.url])), [emoji.data]);

  const msgs = useInfiniteQuery({
    queryKey: ['messages', conv.id], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<{ messages: Message[]; hasMore: boolean }>(`/messages/conversations/${conv.id}/messages${pageParam ? `?before=${enc(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.createdAt : undefined),
  });
  const list = useMemo(() => [...(msgs.data?.pages ?? [])].reverse().flatMap((p) => p.messages), [msgs.data]);
  const markRead = () => api.post(`/messages/conversations/${conv.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['conversations'] })).catch(() => undefined);

  useEffect(() => { markRead(); }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!msgs.isFetchingNextPage) bottom.current?.scrollIntoView({ block: 'end' }); }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.emit('conv:join', conv.id);
    const upsert = (m: Message) => {
      if (m.conversationId !== conv.id) return;
      qc.setQueryData(['messages', conv.id], (old: any) => {
        if (!old) return old;
        const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.map((x: Message) => (x.id === m.id ? { ...m, reactions: m.reactions } : x)) }));
        const exists = pages.some((p: any) => p.messages.some((x: Message) => x.id === m.id));
        if (!exists) pages[0] = { ...pages[0], messages: [...pages[0].messages, m] };
        return { ...old, pages };
      });
    };
    const onMessage = (m: Message) => { upsert(m); if (m.conversationId === conv.id && m.userId !== user?.id) { if (document.visibilityState === 'visible') markRead(); setTyping((t) => { const n = { ...t }; delete n[m.userId]; return n; }); } };
    const onUpdated = (m: Message) => { if (m.conversationId === conv.id) msgs.refetch(); };
    const onTyping = (p: { conversationId: string; userId: string; username: string; typing: boolean }) => {
      if (p.conversationId !== conv.id) return;
      setTyping((t) => { const n = { ...t }; if (p.typing) n[p.userId] = p.username; else delete n[p.userId]; return n; });
    };
    const onRead = (p: { conversationId: string; userId: string; at: string }) => p.conversationId === conv.id && setReads((r) => ({ ...r, [p.userId]: p.at }));
    s.on('message', onMessage); s.on('message:updated', onUpdated); s.on('typing', onTyping); s.on('read', onRead);
    return () => { s.off('message', onMessage); s.off('message:updated', onUpdated); s.off('typing', onTyping); s.off('read', onRead); };
  }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const typingTimer = useRef<number>();
  const onType = (v: string) => {
    setText(v);
    const s = getSocket();
    if (!s) return;
    if (!typingTimer.current) s.emit('typing', { conversationId: conv.id, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { s.emit('typing', { conversationId: conv.id, typing: false }); typingTimer.current = undefined; }, 2500);
  };

  const send = async (attachment?: { url: string; kind: 'image' | 'gif' }) => {
    const body = text.trim();
    if (!body && !attachment) return;
    try {
      if (editing) { await api.patch(`/messages/messages/${editing.id}`, { body }); setEditing(null); }
      else await api.post(`/messages/conversations/${conv.id}/messages`, { body, replyTo: reply?.id, attachmentUrl: attachment?.url, attachmentKind: attachment?.kind });
      setText(''); setReply(null);
      getSocket()?.emit('typing', { conversationId: conv.id, typing: false });
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    try { const r = await api.upload(f); await send({ url: r.url, kind: f.type === 'image/gif' ? 'gif' : 'image' }); } catch (e: any) { toast(e.message, 'error'); }
  };
  const react = (m: Message, e: string) => api.post(`/messages/messages/${m.id}/react`, { emoji: e }).then(() => msgs.refetch());
  const other = conv.kind === 'dm' ? conv.members.find((m) => m.id !== user?.id) : null;
  const typers = Object.values(typing);

  // Render text with :custom_emoji: replaced by images.
  const renderBody = (body: string) => body.split(/(:[a-z0-9_]{2,32}:)/g).map((part, i) => {
    const url = part.startsWith(':') && part.endsWith(':') ? emojiMap.get(part.slice(1, -1)) : undefined;
    return url ? <img key={i} src={url} alt={part} title={part} className="inline h-5 w-5 align-text-bottom" /> : <span key={i}>{part}</span>;
  });

  return (
    <>
      <header className="flex items-center gap-3 px-3 h-14 border-b border-border shrink-0">
        <button className="btn-icon md:hidden" onClick={() => nav('/messages')} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        {other ? <Link to={`/u/${other.username}`} className="flex items-center gap-2 min-w-0"><Avatar user={other} size={34} /><div className="min-w-0"><div className="font-medium text-sm truncate">{other.displayName}</div><div className="text-xs text-muted">{typers.length ? 'typing…' : other.presence.online ? 'Online' : other.presence.lastSeenAt ? `Last seen ${timeAgo(other.presence.lastSeenAt)}` : `@${other.username}`}</div></div></Link>
          : <div className="min-w-0"><div className="font-medium text-sm truncate">{conv.name}</div><div className="text-xs text-muted truncate">{typers.length ? `${typers.join(', ')} typing…` : `${conv.members.length} members · ${conv.members.filter((m) => m.presence.online).length} online`}</div></div>}
        <div className="flex-1" />
        <ConvMenu conv={conv} other={other} />
      </header>
      <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {msgs.hasNextPage && <div className="text-center"><button className="btn-ghost text-xs" onClick={() => msgs.fetchNextPage()}>{msgs.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load earlier messages'}</button></div>}
        {msgs.isLoading && <Spinner />}
        {list.map((m, i) => {
          const mine = m.userId === user?.id;
          const prev = list[i - 1];
          const grouped = prev && prev.userId === m.userId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
          const author = conv.members.find((x) => x.id === m.userId);
          const readBy = mine && i === list.length - 1 ? conv.members.filter((x) => x.id !== user?.id && reads[x.id] && reads[x.id]! >= m.createdAt) : [];
          return (
            <div key={m.id} className={cls('group flex gap-2', mine && 'flex-row-reverse', !grouped && 'pt-2')}>
              <div className="w-8 shrink-0">{!mine && !grouped && <Avatar user={author} size={32} />}</div>
              <div className={cls('max-w-[78%] min-w-0 flex flex-col', mine ? 'items-end' : 'items-start')}>
                {!grouped && !mine && conv.kind === 'group' && <span className="text-xs text-muted mb-0.5">{author?.displayName ?? 'Former member'}</span>}
                {m.replyTo && <div className="text-xs text-muted border-l-2 border-primary/60 pl-2 mb-0.5 truncate max-w-full">↪ {m.replyTo.author}: {m.replyTo.body || 'message'}</div>}
                <div className={cls('rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap', mine ? 'bg-primary text-on-primary rounded-br-md' : 'bg-surface-2 rounded-bl-md', m.deleted && 'italic opacity-60')}>
                  {m.deleted ? 'Message deleted' : <>
                    {m.attachmentUrl && <a href={m.attachmentUrl} target="_blank" rel="noreferrer"><img src={m.attachmentUrl} alt={m.attachmentKind === 'gif' ? 'GIF' : 'Image'} className="rounded-lg max-h-72 mb-1" loading="lazy" /></a>}
                    {renderBody(m.body)}
                  </>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                  {m.reactions.map((r) => <button key={r.emoji} onClick={() => react(m, r.emoji)} className={cls('rounded-full border px-1.5 h-5 text-xs', r.mine ? 'border-primary/60 bg-primary/10' : 'border-border')}>{r.emoji} {r.count}</button>)}
                  <span>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{m.editedAt && ' · edited'}</span>
                  {readBy.length > 0 && <span className="inline-flex items-center gap-0.5 text-primary"><CheckCheck className="h-3 w-3" />Seen</span>}
                </div>
              </div>
              {!m.deleted && (
                <div className="self-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex">
                  <Menu align={mine ? 'right' : 'left'} trigger={() => <button className="btn-icon h-7 w-7" aria-label="React"><Smile className="h-4 w-4" /></button>}>
                    {(close) => <div className="flex gap-1 px-2 py-1">{QUICK.map((e) => <button key={e} className="h-8 w-8 rounded hover:bg-hover/[0.08] text-lg" onClick={() => { react(m, e); close(); }}>{e}</button>)}</div>}
                  </Menu>
                  <button className="btn-icon h-7 w-7" onClick={() => setReply(m)} aria-label="Reply"><Reply className="h-4 w-4" /></button>
                  {mine && <button className="btn-icon h-7 w-7" onClick={() => { setEditing(m); setText(m.body); }} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
                  {mine && <button className="btn-icon h-7 w-7" onClick={() => api.del(`/messages/messages/${m.id}`).then(() => msgs.refetch())} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              )}
            </div>
          );
        })}
        {typers.length > 0 && <div className="text-xs text-muted pl-10 pt-1 animate-pulse">{typers.join(', ')} {typers.length === 1 ? 'is' : 'are'} typing…</div>}
        <div ref={bottom} />
      </div>
      <footer className="border-t border-border p-2 shrink-0">
        {(reply || editing) && <div className="flex items-center gap-2 text-xs text-muted px-2 pb-1.5"><span className="flex-1 truncate">{editing ? 'Editing message' : `Replying to ${conv.members.find((x) => x.id === reply!.userId)?.displayName}: ${reply!.body}`}</span><button onClick={() => { setReply(null); setEditing(null); setText(''); }} aria-label="Cancel"><X className="h-3.5 w-3.5" /></button></div>}
        <div className="flex items-end gap-1">
          <label className="btn-icon cursor-pointer" aria-label="Send an image"><ImageIcon className="h-5 w-5" /><input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
          <button className="btn-icon text-xs font-bold" onClick={() => setGif(true)} aria-label="Send a GIF">GIF</button>
          <textarea rows={1} className="textarea flex-1 resize-none max-h-32 py-2" placeholder="Message" value={text} onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') { setReply(null); setEditing(null); } }} />
          <button className="btn-primary h-9 w-9 p-0" onClick={() => send()} aria-label="Send"><Send className="h-4 w-4" /></button>
        </div>
        {!!emoji.data?.length && <div className="text-[10px] text-muted px-2 pt-1">Custom emoji: {emoji.data.slice(0, 8).map((e) => `:${e.name}:`).join(' ')}</div>}
      </footer>
      <GifModal open={gif} onClose={() => setGif(false)} onSend={(url) => { setGif(false); send({ url, kind: 'gif' }); }} />
    </>
  );
}

function GifModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (url: string) => void }) {
  const [url, setUrl] = useState('');
  const ok = /^https:\/\/(media\d*\.giphy\.com|media\.tenor\.com|i\.imgur\.com)\/\S+$/.test(url);
  return (
    <Modal open={open} onClose={onClose} title="Send a GIF" footer={<button className="btn-primary" disabled={!ok} onClick={() => { onSend(url); setUrl(''); }}>Send</button>}>
      <input className="input" placeholder="Paste a Giphy, Tenor or Imgur GIF link" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
      {ok && <img src={url} alt="GIF preview" className="mt-3 rounded max-h-60" />}
      <p className="text-xs text-muted mt-2">Or upload a .gif file with the image button.</p>
    </Modal>
  );
}

function ConvMenu({ conv, other }: { conv: Conversation; other: Conversation['members'][number] | null | undefined }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [val, setVal] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['conversations'] });
  return (
    <>
      <Menu trigger={() => <button className="btn-icon" aria-label="Conversation options"><MoreVertical className="h-5 w-5" /></button>}>
        {(close) => (
          <>
            <MenuItem icon={conv.muted ? <Bell /> : <BellOff />} onClick={() => { api.patch(`/messages/conversations/${conv.id}`, { muted: !conv.muted }).then(refresh); close(); }}>{conv.muted ? 'Unmute' : 'Mute notifications'}</MenuItem>
            {conv.kind === 'group' && <MenuItem icon={<UserPlus />} onClick={() => { setAdding(true); close(); }}>Add people</MenuItem>}
            {conv.kind === 'group' && <MenuItem icon={<Pencil />} onClick={() => { setVal(conv.name); setRenaming(true); close(); }}>Rename group</MenuItem>}
            {other && <MenuItem danger onClick={() => { if (confirm(`Block ${other.displayName}? They won't be able to message you.`)) api.post(`/u/${other.username}/block`, { kind: 'block' }).then(() => toast('User blocked')); close(); }}>Block {other.displayName}</MenuItem>}
            {other && <div className="px-3 py-2"><ReportButton targetType="user" targetId={other.id} label={`Report ${other.displayName}`} /></div>}
            <MenuItem icon={<LogOut />} danger onClick={() => { api.del(`/messages/conversations/${conv.id}/members/me`).then(() => { refresh(); nav('/messages'); }); close(); }}>{conv.kind === 'group' ? 'Leave group' : 'Hide conversation'}</MenuItem>
          </>
        )}
      </Menu>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add people" footer={<button className="btn-primary" onClick={() => api.post(`/messages/conversations/${conv.id}/members`, { username: val }).then(() => { setAdding(false); setVal(''); refresh(); }).catch((e) => toast(e.message, 'error'))}>Add</button>}>
        <input className="input" placeholder="Username" value={val} onChange={(e) => setVal(e.target.value)} />
      </Modal>
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename group" footer={<button className="btn-primary" onClick={() => api.patch(`/messages/conversations/${conv.id}`, { name: val }).then(() => { setRenaming(false); refresh(); })}>Save</button>}>
        <input className="input" value={val} onChange={(e) => setVal(e.target.value)} />
      </Modal>
    </>
  );
}
