import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Download, RefreshCw, Unplug } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/app';
import { STATUS_LABEL, timeAgo } from '@/lib/format';
import { Avatar, Cover, Segmented, Spinner, Toggle } from '@/components/ui';
import { Card } from './Settings';
import { useState } from 'react';

interface Provider {
  id: 'mal' | 'anilist'; name: string; configured: boolean; connected: boolean; account: { id: string; name: string; avatarUrl: string | null } | null;
  lastSyncAt: string | null; lastError: string | null; linkedEntries: number;
  settings: { mode: 'auto' | 'manual'; onChapterComplete: boolean; importNew: boolean; exportNew: boolean; conflictStrategy: string; syncRatings: boolean };
}
type Side = { status: keyof typeof STATUS_LABEL; progress: number; progressVolumes: number; score: number | null };

export default function Integrations() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<{ providers: Provider[]; conflicts: { id: string; provider: string; local: Side; remote: Side; title: any }[] }>('/integrations') });
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    const ok = params.get('connected'), err = params.get('error');
    if (ok) toast(`Connected to ${ok === 'mal' ? 'MyAnimeList' : 'AniList'} — run a sync to import your list.`, 'success');
    if (err) toast(`Connection failed: ${err}`, 'error');
    if (ok || err) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async (p: Provider) => {
    setSyncing(p.id);
    try {
      const r = await api.post(`/integrations/${p.id}/sync`);
      toast(`${p.name}: ${r.imported} imported, ${r.pulled} updated here, ${r.pushed} sent, ${r.conflicts} need review${r.unmatched.length ? `, ${r.unmatched.length} unmatched` : ''}`, r.conflicts ? 'info' : 'success');
    } catch (e: any) { toast(e.message, 'error'); } finally { setSyncing(null); q.refetch(); }
  };
  const setSetting = (p: Provider, patch: Partial<Provider['settings']>) => api.patch(`/integrations/${p.id}/settings`, patch).then(() => q.refetch());

  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-2">Integrations</h1>
      <p className="text-sm text-muted mb-5">Connect MyAnimeList or AniList through their official OAuth. Kimoto imports your list, keeps progress, status and ratings in sync, and asks you whenever both sides changed.</p>
      {q.isLoading ? <Spinner /> : (
        <>
          {!!q.data?.conflicts.length && (
            <Card title={`${q.data.conflicts.length} entr${q.data.conflicts.length === 1 ? 'y needs' : 'ies need'} your decision`} description="These changed both in Kimoto and on the tracker since the last sync. Nothing was overwritten.">
              <ul className="space-y-3">{q.data.conflicts.map((c) => <Conflict key={c.id} c={c} onDone={() => q.refetch()} />)}</ul>
            </Card>
          )}
          {q.data?.providers.map((p) => (
            <Card key={p.id} title={p.name}>
              {!p.configured ? (
                <p className="text-sm text-muted">Not configured on this server. The admin needs to register an API client with {p.name} and set <code className="text-xs">{p.id === 'mal' ? 'MAL_CLIENT_ID' : 'ANILIST_CLIENT_ID / ANILIST_CLIENT_SECRET'}</code> (see README).</p>
              ) : !p.connected ? (
                <a href={`/api/integrations/${p.id}/connect`} className="btn-primary">Connect {p.name}</a>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Avatar user={{ username: p.account!.name, displayName: p.account!.name, avatarUrl: p.account!.avatarUrl }} size={40} />
                    <div className="flex-1"><div className="font-medium">{p.account!.name}</div><div className="text-xs text-muted">{p.linkedEntries} linked entries · {p.lastSyncAt ? `synced ${timeAgo(p.lastSyncAt)}` : 'never synced'}</div></div>
                    <button className="btn-primary" disabled={syncing === p.id} onClick={() => sync(p)}>{syncing === p.id ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}Sync now</button>
                  </div>
                  {p.lastError && <p className="text-xs text-warning flex gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{p.lastError}</p>}
                  <div className="flex items-center justify-between text-sm"><span>Synchronization</span><Segmented size="sm" value={p.settings.mode} onChange={(mode) => setSetting(p, { mode })} options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} /></div>
                  {p.settings.mode === 'manual' && <Toggle label="Still sync when I finish a chapter" checked={p.settings.onChapterComplete} onChange={(v) => setSetting(p, { onChapterComplete: v })} />}
                  <Toggle label={`Import titles that are only on ${p.name}`} checked={p.settings.importNew} onChange={(v) => setSetting(p, { importNew: v })} />
                  <Toggle label={`Export titles that are only in Kimoto`} description="For titles linked to this tracker." checked={p.settings.exportNew} onChange={(v) => setSetting(p, { exportNew: v })} />
                  <Toggle label="Sync ratings" checked={p.settings.syncRatings} onChange={(v) => setSetting(p, { syncRatings: v })} />
                  <div className="flex items-center justify-between text-sm gap-3"><span>When both sides changed</span>
                    <Segmented size="sm" value={p.settings.conflictStrategy} onChange={(conflictStrategy) => setSetting(p, { conflictStrategy })} options={[{ value: 'ask', label: 'Ask me' }, { value: 'highest_progress', label: 'Furthest progress' }, { value: 'prefer_local', label: 'Kimoto wins' }, { value: 'prefer_remote', label: `${p.name} wins` }]} /></div>
                  <button className="btn-ghost text-danger" onClick={() => confirm(`Disconnect ${p.name}? Your Kimoto library is kept.`) && api.del(`/integrations/${p.id}`).then(() => q.refetch())}><Unplug className="h-4 w-4" />Disconnect</button>
                </div>
              )}
            </Card>
          ))}
          <Card title="Export your list" description="A MyAnimeList-format XML file you can import on MAL, AniList and most trackers.">
            <a href="/api/integrations/export/mal.xml" className="btn-outline" download><Download className="h-4 w-4" />Download mangalist.xml</a>
          </Card>
        </>
      )}
    </>
  );
}

function Conflict({ c, onDone }: { c: { id: string; provider: string; local: Side; remote: Side; title: any }; onDone: () => void }) {
  const toast = useToast();
  const resolve = (choice: 'local' | 'remote' | 'merge') => api.post(`/integrations/conflicts/${c.id}/resolve`, { choice }).then(() => { toast('Resolved', 'success'); onDone(); }).catch((e) => toast(e.message, 'error'));
  const name = c.provider === 'mal' ? 'MyAnimeList' : 'AniList';
  const Row = ({ s }: { s: Side }) => <span className="text-xs">{STATUS_LABEL[s.status]} · ch. {s.progress}{s.progressVolumes ? ` · vol. ${s.progressVolumes}` : ''} · {s.score ? `${s.score}/10` : 'unrated'}</span>;
  return (
    <li className="flex gap-3 items-start border border-border rounded p-3">
      <Cover src={c.title.coverUrl} alt={c.title.title} className="w-10 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{c.title.title}</div>
        <div className="grid sm:grid-cols-2 gap-1 mt-1 text-muted"><div><b className="text-fg text-xs">Kimoto:</b> <Row s={c.local} /></div><div><b className="text-fg text-xs">{name}:</b> <Row s={c.remote} /></div></div>
        <div className="flex flex-wrap gap-2 mt-2">
          <button className="btn-outline h-8" onClick={() => resolve('local')}>Keep Kimoto</button>
          <button className="btn-outline h-8" onClick={() => resolve('remote')}>Keep {name}</button>
          <button className="btn-primary h-8" onClick={() => resolve('merge')}><ArrowRightLeft className="h-4 w-4" />Merge (furthest progress)</button>
        </div>
      </div>
    </li>
  );
}
