import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Bell, BookOpen, Compass, Download, Home, Library, LogOut, MessageCircle, Moon, PanelLeftClose, PanelLeftOpen,
  Search, Settings, Shield, Shuffle, Sun, User, Users, WifiOff, MoreHorizontal, Command,
} from 'lucide-react';
import { api, qs } from '@/lib/api';
import { cls } from '@/lib/format';
import { layoutFrom, type NavItem } from '@/lib/prefs';
import type { Title } from '@/lib/types';
import { useAuth } from '@/hooks/app';
import { Avatar, Menu, MenuItem, Modal, Spinner, useDebounced } from './ui';
import { titleHref } from './titles';

const NAV: Record<NavItem, { to: string; label: string; icon: typeof Home }> = {
  home: { to: '/', label: 'Home', icon: Home },
  discover: { to: '/discover', label: 'Discover', icon: Compass },
  library: { to: '/library', label: 'Library', icon: Library },
  downloads: { to: '/downloads', label: 'Downloads', icon: Download },
  stats: { to: '/stats', label: 'Statistics', icon: BarChart3 },
  community: { to: '/community', label: 'Community', icon: Users },
  messages: { to: '/messages', label: 'Messages', icon: MessageCircle },
  profile: { to: '/profile', label: 'Profile', icon: User },
};

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

export function Layout() {
  const { user, prefs, setPrefs, unread, logout } = useAuth();
  const layout = layoutFrom(prefs);
  const nav = useNavigate();
  const loc = useLocation();
  const online = useOnline();
  const [palette, setPalette] = useState(false);
  const collapsed = layout.sidebar === 'collapsed';
  const items = layout.navOrder.filter((n) => !layout.navHidden.includes(n));
  const badge = (n: NavItem) => (n === 'messages' ? unread.messages : 0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => setPalette(false), [loc.pathname]);

  const mobileMain = items.slice(0, 4);
  const mobileMore = items.slice(4);

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className={cls('hidden md:flex flex-col sticky top-0 h-screen shrink-0 border-r border-border bg-surface/60 backdrop-blur transition-[width]', collapsed ? 'w-[68px]' : 'w-60')}>
        <div className={cls('flex items-center h-14 px-4 gap-2', collapsed && 'justify-center px-0')}>
          <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg tracking-tight"><img src="/icon.svg" alt="" className="h-7 w-7" />{!collapsed && 'Kimoto'}</Link>
        </div>
        <nav className="flex-1 px-2.5 py-2 space-y-0.5 overflow-y-auto" aria-label="Main">
          {items.map((n) => {
            const { to, label, icon: Icon } = NAV[n];
            return (
              <NavLink key={n} to={to} end={to === '/'} title={collapsed ? label : undefined}
                className={({ isActive }) => cls('flex items-center gap-3 rounded h-10 text-sm transition-colors relative', collapsed ? 'justify-center' : 'px-3', isActive ? 'bg-selected/15 text-fg font-medium' : 'text-muted hover:text-fg hover:bg-hover/[0.05]')}>
                <Icon className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{label}</span>}
                {badge(n) > 0 && <span className={cls('min-w-5 h-5 px-1 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center', collapsed && 'absolute top-0.5 right-1.5 min-w-4 h-4 text-[10px]')}>{badge(n) > 99 ? '99+' : badge(n)}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-2.5 pb-3 space-y-0.5">
          {(user?.role === 'moderator' || user?.role === 'admin') && <SideLink to="/moderation" icon={Shield} label="Moderation" collapsed={collapsed} />}
          <SideLink to="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
          <button onClick={() => setPrefs({ layout: { sidebar: collapsed ? 'expanded' : 'collapsed' } })} className={cls('w-full flex items-center gap-3 rounded h-10 text-sm text-muted hover:text-fg hover:bg-hover/[0.05]', collapsed ? 'justify-center' : 'px-3')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <><PanelLeftClose className="h-[18px] w-[18px]" />Collapse</>}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 h-14 flex items-center gap-2 px-4 border-b border-border bg-bg/80 backdrop-blur">
          <Link to="/" className="md:hidden flex items-center gap-2 font-display font-bold"><img src="/icon.svg" alt="" className="h-7 w-7" /></Link>
          <button onClick={() => setPalette(true)} className="flex-1 max-w-xl h-9 rounded bg-surface-2 border border-border px-3 flex items-center gap-2 text-sm text-muted hover:border-fg/20 transition-colors">
            <Search className="h-4 w-4" /><span className="flex-1 text-left truncate">Search titles, people, pages…</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[11px] border border-border rounded px-1.5 py-0.5"><Command className="h-3 w-3" />K</kbd>
          </button>
          <div className="flex-1 hidden lg:block" />
          {!online && <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-warning"><WifiOff className="h-4 w-4" />Offline</span>}
          {user ? (
            <>
              <Link to="/notifications" className="btn-icon relative" aria-label={`Notifications${unread.notifications ? `, ${unread.notifications} unread` : ''}`}>
                <Bell className="h-[18px] w-[18px]" />
                {unread.notifications > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">{unread.notifications > 99 ? '99+' : unread.notifications}</span>}
              </Link>
              <Menu trigger={() => <button className="rounded-full ml-1" aria-label="Account menu"><Avatar user={user} size={32} /></button>}>
                {(close) => (
                  <>
                    <div className="px-3 py-2 border-b border-border mb-1"><div className="text-sm font-medium">{user.displayName}</div><div className="text-xs text-muted">@{user.username}</div></div>
                    <MenuItem icon={<User />} onClick={() => { nav(`/u/${user.username}`); close(); }}>Profile</MenuItem>
                    <MenuItem icon={<BookOpen />} onClick={() => { nav('/lists'); close(); }}>My lists</MenuItem>
                    <MenuItem icon={<Settings />} onClick={() => { nav('/settings'); close(); }}>Settings</MenuItem>
                    {(user.role === 'moderator' || user.role === 'admin') && <MenuItem icon={<Shield />} onClick={() => { nav('/moderation'); close(); }}>Moderation</MenuItem>}
                    <div className="my-1 border-t border-border" />
                    <MenuItem icon={<LogOut />} onClick={async () => { close(); await logout(); nav('/login'); }}>Sign out</MenuItem>
                  </>
                )}
              </Menu>
            </>
          ) : (
            <div className="flex gap-2"><Link to="/login" className="btn-ghost">Sign in</Link><Link to="/register" className="btn-primary">Join</Link></div>
          )}
        </header>

        {user && !user.emailVerified && <VerifyBanner />}

        <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 py-5 pb-24 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/95 backdrop-blur safe-bottom" aria-label="Main">
        <div className="grid grid-cols-5 h-14">
          {mobileMain.map((n) => {
            const { to, label, icon: Icon } = NAV[n];
            return (
              <NavLink key={n} to={to} end={to === '/'} className={({ isActive }) => cls('flex flex-col items-center justify-center gap-0.5 text-[10px] relative', isActive ? 'text-primary' : 'text-muted')}>
                <Icon className="h-5 w-5" />{label}
                {badge(n) > 0 && <span className="absolute top-1.5 right-[28%] h-2 w-2 rounded-full bg-accent" />}
              </NavLink>
            );
          })}
          <Menu align="right" up trigger={() => (
            <button className="h-14 w-full flex flex-col items-center justify-center gap-0.5 text-[10px] text-muted relative"><MoreHorizontal className="h-5 w-5" />More
              {mobileMore.some((n) => badge(n) > 0) && <span className="absolute top-1.5 right-[28%] h-2 w-2 rounded-full bg-accent" />}</button>
          )}>
            {(close) => (
              <>
                {mobileMore.map((n) => { const { to, label, icon: Icon } = NAV[n]; return <MenuItem key={n} icon={<Icon />} onClick={() => { nav(to); close(); }}>{label}{badge(n) > 0 ? ` (${badge(n)})` : ''}</MenuItem>; })}
                <MenuItem icon={<Settings />} onClick={() => { nav('/settings'); close(); }}>Settings</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function SideLink({ to, icon: Icon, label, collapsed }: { to: string; icon: typeof Home; label: string; collapsed: boolean }) {
  return (
    <NavLink to={to} title={collapsed ? label : undefined} className={({ isActive }) => cls('flex items-center gap-3 rounded h-10 text-sm transition-colors', collapsed ? 'justify-center' : 'px-3', isActive ? 'bg-selected/15 text-fg' : 'text-muted hover:text-fg hover:bg-hover/[0.05]')}>
      <Icon className="h-[18px] w-[18px]" />{!collapsed && label}
    </NavLink>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('kimoto-verify-hidden') === '1');
  if (hidden) return null;
  return (
    <div className="bg-warning/10 border-b border-warning/30 text-sm px-4 py-2 flex items-center gap-3">
      <span className="flex-1">Please verify your email address to secure your account.</span>
      <button className="link" disabled={sent} onClick={() => api.post('/auth/resend-verification').then(() => setSent(true))}>{sent ? 'Sent — check your inbox' : 'Resend email'}</button>
      <button className="text-muted hover:text-fg" onClick={() => { sessionStorage.setItem('kimoto-verify-hidden', '1'); setHidden(true); }} aria-label="Dismiss">×</button>
    </div>
  );
}

// ---------------- Command palette ----------------
interface Cmd { id: string; label: string; hint?: string; icon?: ReactNode; run: () => void; cover?: string | null }

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { prefs, setPrefs, user } = useAuth();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q.trim(), 250);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  const search = useQuery({
    queryKey: ['palette', dq], enabled: open && dq.length >= 2,
    queryFn: () => api.get<{ items: Title[] }>(`/search${qs({ query: dq, limit: 8 })}`),
  });
  const people = useQuery({
    queryKey: ['palette-users', dq], enabled: open && dq.length >= 2 && !!user,
    queryFn: () => api.get<{ username: string; displayName: string; avatarUrl: string | null }[]>(`/users/search${qs({ q: dq })}`).catch(() => []),
  });

  const dark = prefs.appearance?.themeId !== 'light' && prefs.appearance?.themeId !== 'sakura' && prefs.appearance?.themeId !== 'lavender';
  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => { nav(to); onClose(); };
    const base: Cmd[] = [
      ...Object.entries(NAV).map(([k, v]) => ({ id: `nav-${k}`, label: `Go to ${v.label}`, icon: <v.icon className="h-4 w-4" />, run: go(v.to) })),
      { id: 'notifications', label: 'Go to Notifications', icon: <Bell className="h-4 w-4" />, run: go('/notifications') },
      { id: 'search', label: 'Advanced search', icon: <Search className="h-4 w-4" />, run: go(`/discover/search${q ? qs({ query: q }) : ''}`) },
      { id: 'random', label: 'Random title', icon: <Shuffle className="h-4 w-4" />, run: async () => { onClose(); const t = await api.get<Title>('/random'); nav(titleHref(t)); } },
      { id: 'rankings', label: 'Rankings & leaderboards', icon: <BarChart3 className="h-4 w-4" />, run: go('/community/rankings') },
      { id: 'wrapped', label: 'Reading Wrapped', icon: <BarChart3 className="h-4 w-4" />, run: go('/stats/wrapped') },
      { id: 'theme', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />, run: () => { setPrefs({ appearance: { themeId: dark ? 'light' : 'midnight' } }); onClose(); } },
      { id: 'settings-theme', label: 'Customize theme', icon: <Settings className="h-4 w-4" />, run: go('/settings/appearance') },
      { id: 'settings-reader', label: 'Reader settings', icon: <Settings className="h-4 w-4" />, run: go('/settings/reader') },
      { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, run: go('/settings') },
    ];
    const ql = q.toLowerCase();
    const filtered = q ? base.filter((c) => c.label.toLowerCase().includes(ql)) : base.slice(0, 8);
    const titles: Cmd[] = (search.data?.items ?? []).map((t) => ({ id: t.id, label: t.title, hint: `${t.type}${t.year ? ` · ${t.year}` : ''} · ${t.source}`, cover: t.coverUrl, run: go(titleHref(t)) }));
    const users: Cmd[] = (people.data ?? []).slice(0, 4).map((u) => ({ id: `u-${u.username}`, label: u.displayName, hint: `@${u.username}`, icon: <Avatar user={u as any} size={20} />, run: go(`/u/${u.username}`) }));
    return [...titles, ...users, ...filtered];
  }, [q, search.data, people.data, nav, onClose, setPrefs, dark]);

  useEffect(() => setSel(0), [commands.length]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="-mx-5 -mt-1">
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="h-4 w-4 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, people or commands…" aria-label="Command palette"
            className="flex-1 h-12 bg-transparent outline-none text-sm"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, commands.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); (commands[sel] ?? { run: () => { nav(`/discover/search${qs({ query: q })}`); onClose(); } }).run(); }
            }} />
          {search.isFetching && <Spinner className="h-4 w-4" />}
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1" role="listbox">
          {commands.map((c, i) => (
            <button key={c.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={c.run}
              className={cls('w-full flex items-center gap-3 px-4 py-2 text-left text-sm', i === sel && 'bg-hover/[0.07]')}>
              {c.cover !== undefined ? <img src={c.cover ?? '/icon.svg'} alt="" className="h-10 w-7 object-cover rounded-sm bg-surface-2" /> : <span className="text-muted w-7 flex justify-center">{c.icon}</span>}
              <span className="flex-1 min-w-0 truncate">{c.label}</span>
              {c.hint && <span className="text-xs text-muted truncate max-w-[40%]">{c.hint}</span>}
            </button>
          ))}
          {!commands.length && <div className="px-4 py-6 text-sm text-muted text-center">No matches. Press Enter for advanced search.</div>}
        </div>
      </div>
    </Modal>
  );
}
