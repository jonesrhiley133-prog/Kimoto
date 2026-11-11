import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { enc } from '@/lib/api';
import { Segmented, Toggle } from '@/components/ui';
import type { Entry, Title } from '@/lib/types';
import { Card } from './Settings';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Registers this browser for Web Push. Requires the production build (service worker) and HTTPS or localhost. */
export async function subscribePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;
    const { publicKey } = await api.get<{ publicKey: string }>('/notifications/push-key');
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
    await api.post('/notifications/push-subscribe', sub.toJSON());
    return true;
  } catch {
    return false;
  }
}
async function unsubscribePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api.post('/notifications/push-unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined); await sub.unsubscribe(); }
}

const CATS: [string, string, string][] = [
  ['chapter', 'New chapters', 'For titles in your library (choose per title below)'],
  ['friend', 'Friend requests', ''], ['follow', 'New followers', ''], ['message', 'Messages', 'Direct and group messages'], ['reply', 'Comment replies', ''],
  ['reaction', 'Reactions', 'Likes on your comments'], ['list', 'List invitations', ''], ['community', 'Community interactions', 'Comments on your discussions and lists, list likes'],
  ['system', 'Announcements', 'Important news from the instance admins'],
];

export default function NotificationSettings() {
  const { prefs, setPrefs } = useAuth();
  const toast = useToast();
  const n = prefs.notifications ?? {};
  const [perm, setPerm] = useState<string>('Notification' in window ? Notification.permission : 'unsupported');
  useEffect(() => { if ('Notification' in window) setPerm(Notification.permission); }, []);
  const lib = useQuery({ queryKey: ['library', 'notify'], queryFn: () => api.get<{ items: { entry: Entry; title: Title }[] }>('/library?sort=title') });
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Notifications</h1>
      <Card title="Categories">
        {CATS.map(([k, l, d]) => <Toggle key={k} label={l} description={d || undefined} checked={n.categories?.[k] !== false} onChange={(v) => setPrefs({ notifications: { categories: { [k]: v } } })} />)}
      </Card>
      <Card title="Delivery">
        <Toggle label="Browser notifications" description={perm === 'denied' ? 'Blocked in your browser settings.' : perm === 'unsupported' ? 'Not supported in this browser.' : 'Pop-ups while Kimoto is open in the background.'}
          checked={n.browser !== false && perm === 'granted'} disabled={perm === 'denied' || perm === 'unsupported'}
          onChange={async (v) => { if (v && perm !== 'granted') { const p = await Notification.requestPermission(); setPerm(p); setPrefs({ notifications: { browser: p === 'granted' } }); } else setPrefs({ notifications: { browser: v } }); }} />
        <Toggle label="Push notifications on this device" description="Get notified even when Kimoto is closed (installed app or supported browsers)."
          checked={!!n.push} onChange={async (v) => {
            if (v) { const ok = await subscribePush(); setPrefs({ notifications: { push: ok } }); if (!ok) toast('Push could not be enabled here (needs the installed/production app and permission).', 'error'); }
            else { await unsubscribePush(); setPrefs({ notifications: { push: false } }); }
          }} />
        <div className="flex items-center justify-between py-2 text-sm gap-3"><span>Push frequency<span className="block text-xs text-muted">Digests bundle notifications into one push.</span></span>
          <Segmented size="sm" value={n.frequency ?? 'instant'} onChange={(v) => setPrefs({ notifications: { frequency: v } })} options={[{ value: 'instant', label: 'Instant' }, { value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }]} /></div>
      </Card>
      <Card title="Per-title chapter alerts" description="Turn new-chapter notifications on or off for individual titles in your library.">
        {!lib.data?.items.length ? <p className="text-sm text-muted">Your library is empty.</p> : (
          <ul className="divide-y divide-border/60 max-h-96 overflow-y-auto -my-1">{lib.data.items.map((i) => (
            <li key={i.title.id}><Toggle label={i.title.title} checked={i.entry.notify} onChange={(v) => api.put(`/library/${enc(i.title.id)}`, { notify: v }).then(() => lib.refetch())} /></li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
