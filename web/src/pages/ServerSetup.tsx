import { useState, type FormEvent } from 'react';
import { Server } from 'lucide-react';
import { checkServer, serverUrl, setServerUrl, setToken } from '@/lib/native';
import { Spinner } from '@/components/ui';

/** First launch of the native app: choose which Kimoto server to use. */
export default function ServerSetup({ onCancel }: { onCancel?: () => void }) {
  const [url, setUrl] = useState(serverUrl() || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const ok = await checkServer(url);
      if (ok !== serverUrl()) setToken(null); // a session belongs to one server
      setServerUrl(ok);
      localStorage.removeItem('kimoto-prefs-cache');
      location.replace('/');
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <img src="/icon.svg" alt="" className="h-14 w-14 mb-6" />
        <h1 className="font-display text-2xl font-bold">Connect to Kimoto</h1>
        <p className="text-sm text-muted mt-2">Enter the address of your Kimoto server. Your library, progress and friends live there, and this app syncs with it.</p>
        <label className="block mt-6">
          <span className="label">Server address</span>
          <div className="relative">
            <Server className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-11 pl-9" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="kimoto.example.com or 192.168.1.20:4000" value={url} onChange={(e) => setUrl(e.target.value)} required autoFocus />
          </div>
        </label>
        {error && <p className="text-sm text-danger mt-3" role="alert">{error}</p>}
        <button className="btn-primary w-full h-11 mt-4" disabled={busy || !url.trim()}>{busy && <Spinner className="h-4 w-4 text-on-primary" />}Connect</button>
        {onCancel && <button type="button" className="btn-ghost w-full mt-2" onClick={onCancel}>Cancel</button>}
        <p className="text-xs text-muted mt-6">For a server on your home network, include the port and use <code>http://</code>, e.g. <code>http://192.168.1.20:4000</code>. Downloaded chapters stay readable offline whatever you pick here.</p>
      </form>
    </div>
  );
}
