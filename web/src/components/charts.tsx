import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/app';
import { SERIES } from '@/lib/theme';
import { cls, duration } from '@/lib/format';

/** Resolved theme colors for charts (SVG attributes can't rely on CSS variables everywhere). */
export function useChartColors() {
  const { prefs, themes } = useAuth();
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => `rgb(${cs.getPropertyValue(`--c-${n}`).trim().split(' ').join(',')})`;
    const bg = cs.getPropertyValue('--c-bg').trim().split(' ').map(Number);
    const dark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.5;
    return { primary: v('primary'), muted: v('muted'), border: v('border'), text: v('text'), surface: v('surface'), surface2: v('surface-2'), series: dark ? SERIES.dark : SERIES.light, dark };
  }, [prefs.appearance, themes]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function tooltipStyle(c: ReturnType<typeof useChartColors>) {
  return {
    contentStyle: { background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12, color: c.text, boxShadow: '0 8px 24px rgba(0,0,0,.25)' },
    labelStyle: { color: c.muted, marginBottom: 4 },
    itemStyle: { color: c.text },
    cursor: { fill: c.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', stroke: c.border },
  };
}
export const axis = (c: ReturnType<typeof useChartColors>) => ({ tick: { fontSize: 11, fill: c.muted }, tickLine: false, axisLine: false });

/**
 * GitHub-style calendar heatmap: one hue (primary), five lightness steps, Monday-first weeks.
 * Every cell has a hover tooltip; a table view is offered for screen readers.
 */
export function Heatmap({ days, metric = 'seconds' }: { days: { date: string; seconds: number; chapters: number }[]; metric?: 'seconds' | 'chapters' }) {
  const [hover, setHover] = useState<{ d: (typeof days)[number]; x: number; y: number } | null>(null);
  const max = Math.max(1, ...days.map((d) => d[metric]));
  const level = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const first = days[0] ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells = [...Array(first).fill(null), ...days];
  const weeks: ((typeof days)[number] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const months: { label: string; col: number }[] = [];
  weeks.forEach((w, i) => {
    const d = w.find(Boolean);
    if (d && (i === 0 || d.date.slice(8) <= '07')) {
      const label = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
      if (!months.length || months[months.length - 1].label !== label) months.push({ label, col: i });
    }
  });
  const OPAC = [0, 0.25, 0.45, 0.7, 1];
  return (
    <div className="relative">
      <div className="overflow-x-auto no-scrollbar">
        <div className="inline-block">
          <div className="relative h-4 ml-7 text-[10px] text-muted">{months.map((m) => <span key={`${m.label}${m.col}`} className="absolute" style={{ left: m.col * 14 }}>{m.label}</span>)}</div>
          <div className="flex gap-0.5">
            <div className="flex flex-col gap-0.5 text-[10px] text-muted w-6 mr-1">{['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => <span key={i} className="h-3 leading-3">{d}</span>)}</div>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                {Array.from({ length: 7 }, (_, j) => {
                  const d = w[j];
                  if (!d) return <span key={j} className="h-3 w-3" />;
                  const l = level(d[metric]);
                  return (
                    <span key={j} className="h-3 w-3 rounded-[3px] border border-border/40" aria-hidden
                      style={{ background: l ? `rgb(var(--c-primary) / ${OPAC[l]})` : 'rgb(var(--c-surface-2))' }}
                      onMouseEnter={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setHover({ d, x: r.left + r.width / 2, y: r.top }); }}
                      onMouseLeave={() => setHover(null)} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 justify-end mt-2 text-[10px] text-muted">Less{OPAC.map((o, i) => <span key={i} className="h-3 w-3 rounded-[3px] border border-border/40" style={{ background: i ? `rgb(var(--c-primary) / ${o})` : 'rgb(var(--c-surface-2))' }} />)}More</div>
      {hover && (
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full panel shadow-card px-2.5 py-1.5 text-xs pointer-events-none" style={{ left: hover.x, top: hover.y - 6 }}>
          <div className="font-medium">{new Date(`${hover.d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
          <div className="text-muted">{duration(hover.d.seconds)} · {hover.d.chapters} chapter{hover.d.chapters === 1 ? '' : 's'}</div>
        </div>
      )}
      <table className="sr-only"><caption>Reading activity per day</caption><tbody>{days.filter((d) => d.seconds || d.chapters).map((d) => <tr key={d.date}><td>{d.date}</td><td>{duration(d.seconds)}</td><td>{d.chapters} chapters</td></tr>)}</tbody></table>
    </div>
  );
}

export function ChartCard({ title, subtitle, children, className = '', action }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cls('card p-4 min-w-0', className)}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div><h3 className="font-medium text-sm">{title}</h3>{subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs mt-3">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} /><span className="text-fg">{i.label}</span>{i.value && <span className="text-muted tabular-nums">{i.value}</span>}</li>)}
    </ul>
  );
}
