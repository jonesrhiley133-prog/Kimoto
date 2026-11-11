import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, Eye, Loader2, X } from 'lucide-react';
import { cls } from '@/lib/format';
import type { MiniUser } from '@/lib/types';

export const Spinner = ({ className = '' }: { className?: string }) => <Loader2 className={cls('animate-spin text-muted', className || 'h-5 w-5')} aria-label="Loading" />;

export function PageLoader() {
  return <div className="flex items-center justify-center py-24"><Spinner className="h-7 w-7" /></div>;
}

export function ErrorState({ error, retry, compact }: { error: unknown; retry?: () => void; compact?: boolean }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Something went wrong');
  return (
    <div className={cls('flex flex-col items-center text-center gap-3', compact ? 'py-6' : 'py-16')}>
      <AlertTriangle className="h-7 w-7 text-warning" />
      <p className="text-sm text-muted max-w-md">{msg}</p>
      {retry && <button className="btn-outline" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-16 px-4">
      {icon && <div className="text-muted mb-1 [&>svg]:h-9 [&>svg]:w-9">{icon}</div>}
      <h3 className="font-medium">{title}</h3>
      {children && <div className="text-sm text-muted max-w-md">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={ref} className={cls('relative panel shadow-card w-full max-h-[92vh] flex flex-col rounded-b-none sm:rounded-lg', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        {title && (
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="font-display font-semibold text-lg">{title}</h2>
            <button className="btn-icon -mr-2" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="px-5 pb-5 pt-1 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cls('flex gap-1 overflow-x-auto no-scrollbar border-b border-border', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cls('px-3 h-10 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors', value === t.id ? 'border-primary text-fg font-medium' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}{t.count != null && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex p-0.5 rounded bg-surface-2 border border-border flex-wrap">
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cls('rounded-sm px-2.5 transition-colors', size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm', value === o.value ? 'bg-primary text-on-primary' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cls('flex items-start justify-between gap-4 py-2', disabled ? 'opacity-50' : 'cursor-pointer')}>
      {(label || description) && (
        <span className="flex-1">
          {label && <span className="block text-sm">{label}</span>}
          {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
        </span>
      )}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cls('relative shrink-0 h-6 w-11 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-border')}>
        <span className={cls('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

export function Range({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block py-1.5">
      <span className="flex justify-between text-sm mb-1.5"><span>{label}</span><span className="text-muted tabular-nums">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--c-primary))]" />
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className = '', label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; label?: string }) {
  return (
    <div className={cls('relative', className)}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="input appearance-none pr-8 cursor-pointer">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="h-4 w-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
    </div>
  );
}

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} className="input w-24 h-8 font-mono text-xs" />
        <input type="color" value={value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 rounded cursor-pointer bg-transparent border border-border" />
      </span>
    </label>
  );
}

export function Avatar({ user, size = 32, className = '' }: { user: Partial<MiniUser> | null | undefined; size?: number; className?: string }) {
  const name = user?.displayName ?? user?.username ?? '?';
  const hue = [...(user?.username ?? '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" width={size} height={size} loading="lazy" className={cls('rounded-full object-cover shrink-0 bg-surface-2', className)} style={{ width: size, height: size }} />
  ) : (
    <span className={cls('rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-white', className)} style={{ width: size, height: size, background: `hsl(${hue} 45% 45%)`, fontSize: size * 0.42 }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function UserLink({ user, className = '' }: { user: MiniUser | null; className?: string }) {
  if (!user) return <span className="text-muted italic">[removed]</span>;
  return (
    <Link to={`/u/${user.username}`} className={cls('font-medium hover:underline', className)}>
      {user.displayName}
      {user.role && user.role !== 'user' && <span className="ml-1.5 text-[10px] uppercase tracking-wide rounded px-1 py-0.5 bg-primary/15 text-primary align-middle">{user.role === 'admin' ? 'Admin' : 'Mod'}</span>}
    </Link>
  );
}

export function Cover({ src, alt, className = '', rounded = true }: { src: string | null | undefined; alt: string; className?: string; rounded?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cls('relative overflow-hidden bg-surface-2 aspect-[2/3]', rounded && 'rounded', className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted bg-gradient-to-br from-surface-2 to-card">{alt}</div>
      )}
    </div>
  );
}

/** Text hidden behind a spoiler warning until clicked. */
export function Spoiler({ children, label = 'Spoiler' }: { children: ReactNode; label?: string }) {
  const [shown, setShown] = useState(false);
  if (shown) return <>{children}</>;
  return (
    <button type="button" onClick={() => setShown(true)} className="w-full text-left rounded bg-surface-2 border border-dashed border-border px-3 py-2 text-sm text-muted hover:text-fg flex items-center gap-2">
      <Eye className="h-4 w-4" /> {label} — click to reveal
    </button>
  );
}

/** Inline ||spoiler|| segments inside text. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\|\|[^|]+\|\|)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (p.startsWith('||') && p.endsWith('||') ? <InlineSpoiler key={i} text={p.slice(2, -2)} /> : <Linkify key={i} text={p} />))}
    </span>
  );
}
function InlineSpoiler({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span role="button" tabIndex={0} onClick={() => setShown(true)} onKeyDown={(e) => e.key === 'Enter' && setShown(true)} title={shown ? undefined : 'Spoiler — click to reveal'}
      className={cls('rounded px-0.5 transition-colors', shown ? 'bg-surface-2' : 'bg-fg text-transparent cursor-pointer select-none')}>
      {text}
    </span>
  );
}
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">{p}</a> : p))}</>;
}

export function Menu({ trigger, children, align = 'right', up = false }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className={cls('absolute z-50 min-w-[12rem] panel shadow-card py-1', up ? 'bottom-full mb-1' : 'mt-1', align === 'right' ? 'right-0' : 'left-0')} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ onClick, children, danger, active, icon }: { onClick: () => void; children: ReactNode; danger?: boolean; active?: boolean; icon?: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={cls('w-full flex items-center gap-2.5 px-3 h-9 text-sm text-left hover:bg-hover/[0.06]', danger && 'text-danger')}>
      {icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {active && <Check className="h-4 w-4 text-primary" />}
    </button>
  );
}

export function Stars({ value, onChange, size = 'md' }: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'md' }) {
  const [hover, setHover] = useState<number | null>(null);
  const v = hover ?? value ?? 0;
  return (
    <div className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(null)} role={onChange ? 'radiogroup' : undefined} aria-label="Rating out of 10">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" disabled={!onChange} aria-label={`${n} of 10`} onMouseEnter={() => onChange && setHover(n)} onClick={() => onChange?.(value === n ? null : n)}
          className={cls('rounded-sm transition-colors', size === 'sm' ? 'h-2.5 w-2.5' : 'h-4 w-3', n <= v ? 'bg-warning' : 'bg-border', onChange && 'hover:scale-110')} />
      ))}
      <span className="ml-2 text-sm tabular-nums text-muted w-8">{value ? `${value}/10` : '—'}</span>
    </div>
  );
}

export function Section({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cls('min-w-0', className)}>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="h-section">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
