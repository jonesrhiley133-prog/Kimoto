import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bell, BookOpen, Download, Eye, EyeOff, Gamepad2, GripVertical, LayoutDashboard, Link2, Lock, Palette, Plug, Server, User, UserCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { cls, timeAgo } from '@/lib/format';
import { layoutFrom, NAV_ITEMS, WIDGETS, type NavItem } from '@/lib/prefs';
import { DEFAULT_DL, enforceStorage } from '@/lib/offline';
import { onDiscordStatus, testCompanion } from '@/lib/discord';
import { downloadFile, isNative } from '@/lib/native';
import { Avatar, Range, Segmented, Select, Spinner, Toggle } from '@/components/ui';
import Appearance from './Appearance';
import ReaderSettings from './ReaderSettings';
import NotificationSettings from './Notifications';
import Integrations from './Integrations';

const SECTIONS = [
  ['account', 'Account', User], ['profile', 'Profile', UserCircle], ['appearance', 'Appearance & themes', Palette], ['layout', 'Layout', LayoutDashboard],
  ['reader', 'Reader', BookOpen], ['notifications', 'Notifications', Bell], ['privacy', 'Privacy', Lock], ['integrations', 'Integrations', Plug],
  ['sources', 'Sources', Server], ['downloads', 'Downloads', Download], ['discord', 'Discord Rich Presence', Gamepad2],
] as const;

export default function Settings() {
  const section = useParams().section ?? 'account';
  return (
    <div className="grid md:grid-cols-[220px_1fr] gap-6">
      <nav className="md:sticky md:top-20 self-start flex md:flex-col gap-1 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0" aria-label="Settings">
        {SECTIONS.filter(([id]) => !(isNative && id === 'discord')).map(([id, label, Icon]) => (
          <NavLink key={id} to={`/settings/${id}`} className={() => cls('flex items-center gap-2.5 rounded px-3 h-9 text-sm whitespace-nowrap shrink-0', section === id ? 'bg-selected/15 text-fg font-medium' : 'text-muted hover:text-fg hover:bg-hover/[0.05]')}>
            <Icon className="h-4 w-4" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 max-w-3xl">
        {section === 'account' && <Account />}
        {section === 'profile' && <ProfileSettings />}
        {section === 'appearance' && <Appearance />}
        {section === 'layout' && <LayoutSettings />}
        {section === 'reader' && <ReaderSettings />}
        {section === 'notifications' && <NotificationSettings />}
        {section === 'privacy' && <Privacy />}
        {section === 'integrations' && <Integrations />}
        {section === 'sources' && <Sources />}
        {section === 'downloads' && <DownloadSettings />}
        {section === 'discord' && <Discord />}
      </div>
    </div>
  );
}

export const Card = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="card p-5 mb-5">
    <h2 className="font-display font-semibold">{title}</h2>
    {description && <p className="text-sm text-muted mt-0.5">{description}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

function Account() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [acct, setAcct] = useState({ username: user!.username, displayName: user!.displayName });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [mail, setMail] = useState({ email: user!.email, password: '' });
  const [del, setDel] = useState({ password: '', confirm: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<any[]>('/auth/sessions') });
  const run = (fn: () => Promise<any>, msg: string) => fn().then((r) => { if (r?.user) setUser(r.user); toast(msg, 'success'); }).catch((e) => toast(e.message, 'error'));
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Account</h1>
      <Card title="Identity">
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className="label">Username</span><input className="input" value={acct.username} onChange={(e) => setAcct({ ...acct, username: e.target.value })} /></label>
          <label><span className="label">Display name</span><input className="input" value={acct.displayName} onChange={(e) => setAcct({ ...acct, displayName: e.target.value })} /></label>
        </div>
        <button className="btn-primary mt-3" onClick={() => run(() => api.patch('/auth/account', acct), 'Saved')}>Save</button>
      </Card>
      <Card title="Email" description={user!.emailVerified ? 'Verified' : 'Not verified yet — check your inbox.'}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className="label">Email</span><input className="input" type="email" value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} /></label>
          <label><span className="label">Current password</span><input className="input" type="password" value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} /></label>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn-primary" disabled={mail.email === user!.email} onClick={() => run(() => api.post('/auth/change-email', mail), 'Email updated — verify the new address')}>Change email</button>
          {!user!.emailVerified && <button className="btn-outline" onClick={() => run(() => api.post('/auth/resend-verification'), 'Verification email sent')}>Resend verification</button>}
        </div>
      </Card>
      <Card title="Password" description="Changing it signs you out of other devices.">
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className="label">Current password</span><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
        </div>
        <button className="btn-primary mt-3" disabled={pw.password.length < 8} onClick={() => run(() => api.post('/auth/change-password', pw).then(() => setPw({ current: '', password: '' })), 'Password changed')}>Update password</button>
      </Card>
      <Card title="Sessions" description="Devices currently signed in to your account.">
        {sessions.isLoading ? <Spinner /> : (
          <ul className="divide-y divide-border/60 -my-2">{sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="flex-1 min-w-0"><div className="truncate">{s.userAgent?.match(/(Firefox|Edg|Chrome|Safari)[/\s][\d.]+/)?.[0] ?? 'Unknown browser'} · {/Mobi|Android|iPhone/.test(s.userAgent) ? 'Mobile' : 'Desktop'}{s.current && <span className="text-success"> · this device</span>}</div>
                <div className="text-xs text-muted">{s.ip} · active {timeAgo(s.lastSeenAt)} · signed in {timeAgo(s.createdAt)}</div></div>
              {!s.current && <button className="btn-ghost h-8 text-danger" onClick={() => api.del(`/auth/sessions/${s.id}`).then(() => sessions.refetch())}>Sign out</button>}
            </li>
          ))}</ul>
        )}
        <button className="btn-outline mt-3" onClick={() => api.del('/auth/sessions/others').then(() => { sessions.refetch(); toast('Signed out other devices', 'success'); })}>Sign out all other devices</button>
      </Card>
      <Card title="Your data" description="Download everything Kimoto stores about you, as JSON.">
        <button className="btn-outline" onClick={() => downloadFile('/auth/export', `kimoto-export-${new Date().toISOString().slice(0, 10)}.json`).catch((e) => toast(e.message, 'error'))}>Export my data</button>
      </Card>
      <Card title="Delete account" description="Permanently deletes your account, library, lists, comments and messages. This cannot be undone.">
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className="label">Password</span><input className="input" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></label>
          <label><span className="label">Type DELETE to confirm</span><input className="input" value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></label>
        </div>
        <button className="btn-danger mt-3" disabled={del.confirm !== 'DELETE'} onClick={() => api.post('/auth/delete-account', del).then(async () => { await logout(); nav('/'); }).catch((e) => toast(e.message, 'error'))}>Delete my account</button>
      </Card>
    </>
  );
}

const SECTION_LABELS: Record<string, string> = {
  currentlyReading: 'Currently reading', completed: 'Completed titles', stats: 'Reading statistics', favoriteGenres: 'Favorite genres', favorites: 'Favorite titles',
  lists: 'Custom lists', activity: 'Recent activity', social: 'Friends, followers & region', integrations: 'MAL / AniList profiles', library: 'Appear as a reader on title pages',
};

function ProfileSettings() {
  const { setUser } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-profile'], queryFn: () => api.get<any>('/me/profile') });
  const [p, setP] = useState<any>(null);
  useEffect(() => { if (q.data) setP(q.data); }, [q.data]);
  if (!p) return <Spinner />;
  const upload = async (field: 'avatarUrl' | 'bannerUrl', f?: File) => {
    if (!f) return;
    try { const r = await api.upload(f); setP({ ...p, [field]: r.url }); } catch (e: any) { toast(e.message, 'error'); }
  };
  const save = () => api.patch('/me/profile', p).then((r) => { setUser(r.user); toast('Profile saved', 'success'); }).catch((e) => toast(e.message, 'error'));
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Profile</h1>
      <Card title="Appearance">
        <div className="relative h-32 rounded-lg overflow-hidden bg-surface-2 mb-4" style={{ background: p.accent ? `linear-gradient(135deg, ${p.accent}, rgb(var(--c-bg)))` : undefined }}>
          {p.bannerUrl && <img src={p.bannerUrl} alt="" className="h-full w-full object-cover" />}
          <label className="absolute right-2 bottom-2 btn-outline bg-bg/70 cursor-pointer h-8">Change banner<input type="file" accept="image/*" className="hidden" onChange={(e) => upload('bannerUrl', e.target.files?.[0])} /></label>
        </div>
        <div className="flex items-center gap-4">
          <Avatar user={{ avatarUrl: p.avatarUrl, username: 'me', displayName: 'Me' }} size={72} />
          <label className="btn-outline cursor-pointer">Upload picture<input type="file" accept="image/*" className="hidden" onChange={(e) => upload('avatarUrl', e.target.files?.[0])} /></label>
          {p.avatarUrl && <button className="btn-ghost" onClick={() => setP({ ...p, avatarUrl: null })}>Remove</button>}
          <label className="ml-auto flex items-center gap-2 text-sm">Profile accent<input type="color" value={p.accent ?? '#8b7cff'} onChange={(e) => setP({ ...p, accent: e.target.value })} /></label>
        </div>
        <label className="block mt-4"><span className="label">Biography</span><textarea className="textarea" rows={4} maxLength={2000} value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} placeholder="Tell people what you love to read" /></label>
        <label className="block mt-3 max-w-xs"><span className="label">Region (optional — used only for regional rankings)</span><input className="input" value={p.region ?? ''} onChange={(e) => setP({ ...p, region: e.target.value || null })} placeholder="e.g. Brazil" /></label>
      </Card>
      <Card title="Visibility" description="Choose who can see each part of your profile.">
        <Toggle label="Public profile" description="When off, only friends can see your profile." checked={p.isPublic} onChange={(v) => setP({ ...p, isPublic: v })} />
        <div className="mt-2 divide-y divide-border/60">
          {Object.entries(SECTION_LABELS).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between py-2 gap-3 text-sm">
              <span className="flex items-center gap-2">{p.visibility[k] === 'private' ? <EyeOff className="h-4 w-4 text-muted" /> : <Eye className="h-4 w-4 text-muted" />}{label}</span>
              <Segmented size="sm" value={p.visibility[k]} onChange={(v) => setP({ ...p, visibility: { ...p.visibility, [k]: v } })} options={[{ value: 'public', label: 'Everyone' }, { value: 'friends', label: 'Friends' }, { value: 'private', label: 'Only me' }]} />
            </div>
          ))}
        </div>
      </Card>
      <button className="btn-primary" onClick={save}>Save profile</button>
    </>
  );
}

function Privacy() {
  const { prefs, setPrefs } = useAuth();
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => api.get<any[]>('/blocks') });
  const pv = prefs.privacy ?? {};
  const set = (k: string, v: unknown) => setPrefs({ privacy: { [k]: v } });
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Privacy</h1>
      <Card title="Messaging & social">
        <div className="flex items-center justify-between py-2 text-sm"><span>Who can message you</span><Select className="w-40" value={pv.allowMessages ?? 'everyone'} onChange={(v) => set('allowMessages', v)} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'friends', label: 'Friends only' }, { value: 'none', label: 'No one' }]} /></div>
        <Toggle label="Allow friend requests" checked={pv.allowFriendRequests !== false} onChange={(v) => set('allowFriendRequests', v)} />
        <Toggle label="Show when I'm online" description="Also hides your last-seen time." checked={pv.showOnline !== false} onChange={(v) => set('showOnline', v)} />
        <Toggle label="Send read receipts" description="If off, you also won't see others' receipts." checked={pv.readReceipts !== false} onChange={(v) => set('readReceipts', v)} />
        <Toggle label="Send typing indicators" checked={pv.typingIndicators !== false} onChange={(v) => set('typingIndicators', v)} />
      </Card>
      <Card title="Activity & rankings">
        <Toggle label="Share activity in feeds" description="Starting, completing, rating and list activity." checked={pv.showActivityInFeed !== false} onChange={(v) => set('showActivityInFeed', v)} />
        <Toggle label="Appear in rankings and leaderboards" checked={pv.showInRankings !== false} onChange={(v) => set('showInRankings', v)} />
        <Toggle label="Record reading statistics" description="Delete recorded history anytime under Statistics → History." checked={prefs.analytics?.enabled !== false} onChange={(v) => setPrefs({ analytics: { enabled: v } })} />
      </Card>
      <Card title="Content">
        <span className="label">Show content rated</span>
        <div className="flex gap-1.5">{[['safe', 'Safe'], ['suggestive', 'Suggestive'], ['erotica', 'Mature (18+)']].map(([k, l]) => {
          const on = (prefs.contentRating ?? ['safe', 'suggestive']).includes(k);
          return <button key={k} className={on ? 'chip-on' : 'chip'} onClick={() => setPrefs({ contentRating: on ? (prefs.contentRating ?? ['safe', 'suggestive']).filter((x: string) => x !== k) : [...(prefs.contentRating ?? ['safe', 'suggestive']), k] })}>{l}</button>;
        })}</div>
      </Card>
      <Card title="Blocked & muted users" description="Blocked users can't message, follow or friend you, and their content is hidden. Muted users' posts are hidden from you.">
        {blocks.isLoading ? <Spinner /> : !blocks.data?.length ? <p className="text-sm text-muted">Nobody blocked or muted.</p> : (
          <ul className="space-y-2">{blocks.data.map((b) => (
            <li key={`${b.id}${b.kind}`} className="flex items-center gap-3 text-sm"><Avatar user={b} size={28} /><span className="flex-1">{b.displayName} <span className="text-muted">@{b.username} · {b.kind}d</span></span>
              <button className="btn-ghost h-8" onClick={() => api.del(`/u/${b.username}/block?kind=${b.kind}`).then(() => blocks.refetch())}>Un{b.kind}</button></li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}

function SortableNav({ id, hidden, onToggle }: { id: NavItem; hidden: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-2 py-1.5 bg-card">
      <button className="btn-icon h-8 w-8 cursor-grab touch-none" {...attributes} {...listeners} aria-label={`Move ${id}`}><GripVertical className="h-4 w-4" /></button>
      <span className={cls('flex-1 text-sm capitalize', hidden && 'text-muted line-through')}>{id === 'stats' ? 'Statistics' : id}</span>
      <button className="btn-icon h-8 w-8" onClick={onToggle} aria-label={hidden ? 'Show' : 'Hide'}>{hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
    </li>
  );
}

function LayoutSettings() {
  const { prefs, setPrefs } = useAuth();
  const l = layoutFrom(prefs);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setPrefs({ layout: { navOrder: arrayMove(l.navOrder, l.navOrder.indexOf(e.active.id as NavItem), l.navOrder.indexOf(e.over.id as NavItem)) } });
  };
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Layout</h1>
      <Card title="Navigation" description="Drag to reorder; hide items you don't use. On phones, the first four appear in the bottom bar.">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={l.navOrder} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border/60">{l.navOrder.map((n) => <SortableNav key={n} id={n} hidden={l.navHidden.includes(n)} onToggle={() => setPrefs({ layout: { navHidden: l.navHidden.includes(n) ? l.navHidden.filter((x) => x !== n) : [...l.navHidden, n] } })} />)}</ul>
          </SortableContext>
        </DndContext>
        <button className="btn-ghost mt-2 text-sm" onClick={() => setPrefs({ layout: { navOrder: [...NAV_ITEMS], navHidden: [] } })}>Reset navigation</button>
      </Card>
      <Card title="Sidebar & density">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm"><span>Desktop sidebar</span><Segmented size="sm" value={l.sidebar} onChange={(v) => setPrefs({ layout: { sidebar: v } })} options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Icons only' }]} /></div>
          <div className="flex items-center justify-between text-sm"><span>Cover size</span><Segmented size="sm" value={l.cardSize} onChange={(v) => setPrefs({ layout: { cardSize: v } })} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} /></div>
          <p className="text-xs text-muted">Spacing density (compact / comfortable / spacious) lives in Appearance.</p>
        </div>
      </Card>
      <Card title="Home dashboard" description="Show or hide widgets. Reorder and resize them with “Customize” on the Home page, where you can also save multiple layouts.">
        <div className="grid sm:grid-cols-2 gap-x-6">{l.widgets.map((w) => <Toggle key={w.id} label={WIDGETS[w.id]} checked={!w.hidden} onChange={(v) => setPrefs({ layout: { widgets: l.widgets.map((x) => (x.id === w.id ? { ...x, hidden: !v } : x)) } })} />)}</div>
      </Card>
    </>
  );
}

function Sources() {
  const q = useQuery({ queryKey: ['sources'], queryFn: () => api.get<any[]>('/sources') });
  const toast = useToast();
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { if (q.data) setList(q.data); }, [q.data]);
  const save = (next: any[]) => { setList(next); api.put('/settings/sources', next.map((s) => ({ id: s.id, enabled: s.enabled }))).then(() => toast('Sources updated', 'success')); };
  const move = (i: number, d: -1 | 1) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; save(n); };
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-2">Sources</h1>
      <p className="text-sm text-muted mb-5">Kimoto reads from modular source providers. Enable the ones you want and set their priority — higher sources are preferred for discovery and search. Providers use official APIs or content you own; add new ones under <code className="text-xs">server/src/sources</code>.</p>
      {q.isLoading ? <Spinner /> : (
        <ul className="space-y-3">{list.map((s, i) => (
          <li key={s.id} className="card p-4 flex gap-4">
            <div className="flex flex-col gap-1">
              <button className="btn-icon h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button className="btn-icon h-7 w-7" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2"><span className="font-medium">{s.name}</span><span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-surface-2 text-muted">{s.kind === 'content' ? 'Reading source' : 'Metadata'}</span>
                {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="text-muted hover:text-fg" aria-label={`${s.name} website`}><Link2 className="h-3.5 w-3.5" /></a>}</div>
              <p className="text-sm text-muted mt-0.5">{s.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-2 text-[11px] text-muted">{[s.capabilities.chapters && 'Chapters', s.capabilities.download && 'Downloads', s.capabilities.novels && 'Light novels', s.capabilities.search && 'Search', ...s.capabilities.discover.slice(0, 4)].filter(Boolean).map((c: string) => <span key={c} className="rounded border border-border px-1.5 py-0.5">{c}</span>)}</div>
            </div>
            <Toggle checked={s.enabled} onChange={(v) => save(list.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))} />
          </li>
        ))}</ul>
      )}
    </>
  );
}

function DownloadSettings() {
  const { prefs, setPrefs } = useAuth();
  const d = { ...DEFAULT_DL, ...(prefs.downloads ?? {}) };
  const set = (patch: Partial<typeof d>) => { setPrefs({ downloads: patch }); setTimeout(() => enforceStorage(), 600); };
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Downloads</h1>
      <Card title="Quality & storage">
        <div className="flex items-center justify-between text-sm py-2"><span>Download quality</span><Segmented size="sm" value={d.quality} onChange={(quality) => set({ quality })} options={[{ value: 'data', label: 'Original' }, { value: 'saver', label: 'Data saver' }]} /></div>
        <Range label="Storage limit" value={d.maxStorageMB} min={256} max={20480} step={256} onChange={(maxStorageMB) => set({ maxStorageMB })} format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`)} />
        <p className="text-xs text-muted">When the limit is reached, chapters you've read are removed first, then the oldest.</p>
      </Card>
      <Card title="Automatic cleanup">
        <Toggle label="Delete chapters after reading" checked={d.autoDeleteRead} onChange={(autoDeleteRead) => set({ autoDeleteRead })} />
        {d.autoDeleteRead && <Range label="Keep read chapters for" value={d.autoDeleteDays} min={0} max={60} onChange={(autoDeleteDays) => set({ autoDeleteDays })} format={(v) => (v === 0 ? 'Delete right away' : `${v} days`)} />}
      </Card>
    </>
  );
}

function Discord() {
  const { prefs, setPrefs } = useAuth();
  const [status, setStatus] = useState('off');
  const [test, setTest] = useState<null | boolean>(null);
  const d = { enabled: false, hideTitle: false, hideChapter: false, hideDuration: false, ...(prefs.discord ?? {}) };
  useEffect(() => onDiscordStatus(setStatus), []);
  const set = (k: string, v: boolean) => setPrefs({ discord: { [k]: v } });
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-2">Discord Rich Presence</h1>
      <p className="text-sm text-muted mb-5">Show what you're reading on your Discord profile — e.g. “Reading Lanterns Over Kirihara · Ch. 3 · 24 minutes”.</p>
      <Card title="How it works" description="Browsers can't talk to the Discord app directly, so Kimoto uses a tiny desktop companion that runs next to Discord.">
        <ol className="list-decimal list-inside text-sm space-y-1.5 text-fg/90">
          <li>Make sure the Discord desktop app is running.</li>
          <li>From the Kimoto folder, run <code className="text-xs bg-surface-2 rounded px-1.5 py-0.5">npm run companion</code> (see <code className="text-xs">companion/README.md</code>).</li>
          <li>Turn on Rich Presence below and open any chapter.</li>
        </ol>
        <div className="flex items-center gap-3 mt-4">
          <button className="btn-outline" onClick={async () => setTest(await testCompanion())}>Test connection</button>
          {test !== null && <span className={cls('text-sm', test ? 'text-success' : 'text-warning')}>{test ? 'Companion is running ✓' : 'Companion not found on this computer'}</span>}
          {d.enabled && <span className="text-xs text-muted ml-auto">Status: {status}</span>}
        </div>
      </Card>
      <Card title="Privacy">
        <Toggle label="Enable Rich Presence" checked={d.enabled} onChange={(v) => set('enabled', v)} />
        <Toggle label="Hide the title" description="Shows “Reading manga” instead." checked={d.hideTitle} onChange={(v) => set('hideTitle', v)} disabled={!d.enabled} />
        <Toggle label="Hide the chapter number" checked={d.hideChapter} onChange={(v) => set('hideChapter', v)} disabled={!d.enabled} />
        <Toggle label="Hide reading duration" checked={d.hideDuration} onChange={(v) => set('hideDuration', v)} disabled={!d.enabled} />
      </Card>
    </>
  );
}
