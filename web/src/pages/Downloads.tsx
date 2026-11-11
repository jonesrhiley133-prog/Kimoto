import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, DownloadCloud, HardDrive, Pause, Play, Settings, Trash2 } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth } from '@/hooks/app';
import { bytes, cls, timeAgo } from '@/lib/format';
import {
  allDownloads, deleteDownload, deviceId, isPaused, pauseAll, pauseOne, resumeAll, resumeOne, storageEstimate, subscribe, type DLRecord,
} from '@/lib/offline';
import { Cover, Empty, Tabs } from '@/components/ui';

function useDownloads() {
  const [list, setList] = useState<DLRecord[]>([]);
  const [paused, setPaused] = useState(isPaused());
  useEffect(() => {
    let alive = true;
    let pending = false;
    const load = () => {
      if (pending) return;
      pending = true;
      // Coalesce rapid progress updates.
      setTimeout(() => { pending = false; allDownloads().then((l) => alive && setList(l)); setPaused(isPaused()); }, 150);
    };
    load();
    const unsub = subscribe(load);
    return () => { alive = false; unsub(); };
  }, []);
  return { list, paused };
}

export default function Downloads() {
  const { list, paused } = useDownloads();
  const { user } = useAuth();
  const [tab, setTab] = useState<'library' | 'queue' | 'devices'>('library');
  const done = list.filter((d) => d.status === 'done');
  const queue = list.filter((d) => d.status !== 'done').sort((a, b) => a.createdAt - b.createdAt);
  const usage = useQuery({ queryKey: ['storage', list.length, done.length], queryFn: storageEstimate });
  const grouped = useMemo(() => {
    const m = new Map<string, DLRecord[]>();
    for (const d of done) m.set(d.titleId, [...(m.get(d.titleId) ?? []), d]);
    return [...m.values()].map((chs) => chs.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
  }, [done]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold">Downloads</h1>
        <div className="flex gap-2">
          {queue.length > 0 && (paused ? <button className="btn-primary" onClick={resumeAll}><Play className="h-4 w-4" />Resume all</button> : <button className="btn-outline" onClick={pauseAll}><Pause className="h-4 w-4" />Pause all</button>)}
          <Link to="/settings/downloads" className="btn-outline"><Settings className="h-4 w-4" />Storage settings</Link>
        </div>
      </div>

      <div className="card p-4 mb-5 flex items-center gap-4">
        <HardDrive className="h-6 w-6 text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm"><b>{bytes(usage.data?.used ?? 0)}</b> used by {done.length} downloaded chapter{done.length === 1 ? '' : 's'}</div>
          {usage.data?.quota && (
            <>
              <div className="h-1.5 rounded-full bg-border mt-2 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, ((usage.data.browserUsage ?? 0) / usage.data.quota) * 100)}%` }} /></div>
              <div className="text-xs text-muted mt-1">{bytes(usage.data.browserUsage ?? 0)} of {bytes(usage.data.quota)} available to Kimoto on this device</div>
            </>
          )}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ id: 'library', label: 'Offline library', count: done.length }, { id: 'queue', label: 'Queue', count: queue.length }, ...(user ? [{ id: 'devices' as const, label: 'Other devices' }] : [])]} />

      {tab === 'library' && (!grouped.length ? (
        <Empty icon={<DownloadCloud />} title="No downloads yet">Download chapters from any title page (where the source allows it) to read without a connection.</Empty>
      ) : (
        <div className="space-y-4">{grouped.map((chs) => (
          <div key={chs[0].titleId} className="card p-3">
            <div className="flex items-center gap-3 mb-2">
              <Cover src={chs[0].coverUrl} alt={chs[0].titleName} className="w-12" />
              <div className="flex-1 min-w-0"><Link to={`/title/${enc(chs[0].titleId)}`} className="font-medium hover:text-primary line-clamp-1">{chs[0].titleName}</Link>
                <div className="text-xs text-muted">{chs.length} chapters · {bytes(chs.reduce((n, c) => n + c.bytes, 0))}</div></div>
              <button className="btn-icon" aria-label="Delete all chapters of this title" onClick={() => confirm(`Delete ${chs.length} downloaded chapters?`) && chs.forEach((c) => deleteDownload(c.chapterId))}><Trash2 className="h-4 w-4" /></button>
            </div>
            <ul className="divide-y divide-border/50">{chs.map((c) => (
              <li key={c.chapterId} className="flex items-center gap-3 py-2 text-sm">
                <Link to={`/read/${enc(c.chapterId)}`} className="flex-1 min-w-0 truncate hover:text-primary">{c.label}</Link>
                {c.readAt && <span className="text-xs text-muted">read {timeAgo(new Date(c.readAt).toISOString())}</span>}
                <span className="text-xs text-muted tabular-nums">{bytes(c.bytes)}</span>
                <button className="btn-icon h-7 w-7" onClick={() => deleteDownload(c.chapterId)} aria-label={`Delete ${c.label}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}</ul>
          </div>
        ))}</div>
      ))}

      {tab === 'queue' && (!queue.length ? <Empty icon={<CheckCircle2 />} title="Queue is empty" /> : (
        <ul className="card divide-y divide-border/60">{queue.map((d) => {
          const pct = d.total ? (d.done / d.total) * 100 : 0;
          return (
            <li key={d.chapterId} className="flex items-center gap-3 p-3">
              <Cover src={d.coverUrl} alt={d.titleName} className="w-9" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{d.titleName}</div>
                <div className="text-xs text-muted truncate">{d.label}</div>
                <div className="h-1 rounded-full bg-border mt-1.5 overflow-hidden"><div className={cls('h-full transition-all', d.status === 'error' ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>
                <div className="text-xs mt-1 flex items-center gap-1.5">
                  {d.status === 'error' ? <span className="text-danger inline-flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5" />{d.error}</span>
                    : <span className="text-muted capitalize">{d.status === 'queued' && paused ? 'paused' : d.status}{d.total ? ` · ${d.done}/${d.total} pages` : ''}{d.bytes ? ` · ${bytes(d.bytes)}` : ''}</span>}
                </div>
              </div>
              {d.status === 'paused' || d.status === 'error' ? <button className="btn-icon" onClick={() => resumeOne(d.chapterId)} aria-label="Resume"><Play className="h-4 w-4" /></button>
                : <button className="btn-icon" onClick={() => pauseOne(d.chapterId)} aria-label="Pause"><Pause className="h-4 w-4" /></button>}
              <button className="btn-icon" onClick={() => deleteDownload(d.chapterId)} aria-label="Cancel"><Trash2 className="h-4 w-4" /></button>
            </li>
          );
        })}</ul>
      ))}

      {tab === 'devices' && <Devices />}
      <p className="text-xs text-muted mt-6">Only chapters that their source permits are downloadable; externally-hosted and DRM-protected chapters open on the publisher's site instead. Downloads are stored in this browser and aren't shared between devices.</p>
    </div>
  );
}

function Devices() {
  const q = useQuery({ queryKey: ['downloads', 'records'], queryFn: () => api.get<any[]>('/settings/downloads') });
  const me = deviceId();
  const byDevice = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of q.data ?? []) if (r.deviceId !== me) m.set(r.deviceId, [...(m.get(r.deviceId) ?? []), r]);
    return [...m.entries()];
  }, [q.data, me]);
  if (!byDevice.length) return <p className="text-sm text-muted">No downloads recorded on your other devices.</p>;
  return (
    <div className="space-y-3">{byDevice.map(([dev, rows]) => (
      <div key={dev} className="card p-3">
        <div className="text-sm font-medium">Device {dev.slice(0, 8)}</div>
        <div className="text-xs text-muted">{rows.filter((r) => r.status === 'done').length} chapters · {bytes(rows.reduce((n, r) => n + r.bytes, 0))} · last activity {timeAgo(rows[0].updatedAt)}</div>
        <ul className="mt-2 text-xs text-muted space-y-0.5">{rows.slice(0, 6).map((r) => <li key={r.chapterId}>{r.title} · Ch. {r.chapterLabel ?? '?'}</li>)}</ul>
      </div>
    ))}</div>
  );
}
