import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/app';
import { Spinner } from '@/components/ui';
import type { SessionUser } from '@/lib/types';
import { isNative, serverUrl, setServerUrl, setToken } from '@/lib/native';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

export default function Auth({ mode }: { mode: Mode }) {
  const { setUser, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ login: '', email: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const next = params.get('next') || '/';
  const token = params.get('token') ?? '';

  useEffect(() => {
    if (mode !== 'verify') return;
    setBusy(true);
    api.post('/auth/verify-email', { token }).then(() => setDone('Your email is verified. Thanks!')).catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, [mode, token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if ((mode === 'register' || mode === 'reset') && f.password !== f.confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      if (mode === 'login') {
        const r = await api.post<{ user: SessionUser; token?: string }>('/auth/login', { login: f.login, password: f.password });
        if (r.token) setToken(r.token);
        setUser(r.user);
        nav(r.user.prefs?.onboarded ? next : '/welcome', { replace: true });
      } else if (mode === 'register') {
        const r = await api.post<{ user: SessionUser; token?: string }>('/auth/register', { email: f.email, username: f.username, password: f.password });
        if (r.token) setToken(r.token);
        setUser(r.user);
        nav('/welcome', { replace: true });
      } else if (mode === 'forgot') {
        await api.post('/auth/forgot-password', { email: f.email });
        setDone("If an account exists for that email, we've sent a reset link.");
      } else if (mode === 'reset') {
        await api.post('/auth/reset-password', { token, password: f.password });
        setDone('Password updated. You can sign in now.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const titles: Record<Mode, [string, string]> = {
    login: ['Welcome back', 'Sign in to continue reading.'],
    register: ['Create your account', 'Track, read and discuss everything you love.'],
    forgot: ['Reset your password', "Enter your email and we'll send a reset link."],
    reset: ['Choose a new password', 'At least 8 characters.'],
    verify: ['Email verification', ''],
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex relative overflow-hidden items-end p-12 bg-gradient-to-br from-primary/30 via-bg to-accent/20">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgb(var(--c-primary)) 0, transparent 40%), radial-gradient(circle at 80% 70%, rgb(var(--c-accent)) 0, transparent 35%)' }} />
        <div className="relative max-w-md">
          <img src="/icon.svg" alt="" className="h-12 w-12 mb-6" />
          <h1 className="font-display text-4xl font-bold leading-tight">Every story you read, in one place.</h1>
          <p className="mt-4 text-muted">Manga, manhwa, webtoons and light novels — a reader built around you, with stats, lists and a community that gets it.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden flex items-center gap-2 font-display font-bold text-xl mb-8"><img src="/icon.svg" alt="" className="h-8 w-8" />Kimoto</Link>
          <h2 className="font-display text-2xl font-semibold">{titles[mode][0]}</h2>
          {titles[mode][1] && <p className="text-sm text-muted mt-1">{titles[mode][1]}</p>}

          {done ? (
            <div className="mt-6 space-y-4">
              <p className="text-sm bg-success/10 border border-success/30 rounded p-3">{done}</p>
              <Link to={user ? '/' : '/login'} className="btn-primary w-full">{user ? 'Continue' : 'Go to sign in'}</Link>
            </div>
          ) : mode === 'verify' ? (
            <div className="mt-6">{busy ? <Spinner /> : error && <p className="text-sm text-danger">{error}</p>}</div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3.5">
              {mode === 'login' && <label className="block"><span className="label">Username or email</span><input className="input h-10" autoComplete="username" required value={f.login} onChange={set('login')} /></label>}
              {(mode === 'register' || mode === 'forgot') && <label className="block"><span className="label">Email</span><input className="input h-10" type="email" autoComplete="email" required value={f.email} onChange={set('email')} /></label>}
              {mode === 'register' && <label className="block"><span className="label">Username</span><input className="input h-10" autoComplete="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" title="Letters, numbers and underscores" value={f.username} onChange={set('username')} /></label>}
              {mode !== 'forgot' && (
                <label className="block">
                  <span className="label flex justify-between">Password {mode === 'login' && <Link to="/forgot-password" className="link font-normal">Forgot?</Link>}</span>
                  <input className="input h-10" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} value={f.password} onChange={set('password')} />
                </label>
              )}
              {(mode === 'register' || mode === 'reset') && <label className="block"><span className="label">Confirm password</span><input className="input h-10" type="password" autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></label>}
              {error && <p className="text-sm text-danger" role="alert">{error}</p>}
              <button className="btn-primary w-full h-10" disabled={busy}>{busy && <Spinner className="h-4 w-4 text-on-primary" />}
                {{ login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Update password', verify: '' }[mode]}
              </button>
            </form>
          )}
          <p className="text-sm text-muted mt-6 text-center">
            {mode === 'login' ? <>New here? <Link to="/register" className="link">Create an account</Link></> : <>Have an account? <Link to="/login" className="link">Sign in</Link></>}
          </p>
          <p className="text-xs text-muted mt-3 text-center"><Link to="/discover" className="hover:text-fg">Browse without an account →</Link></p>
          {isNative && (
            <p className="text-xs text-muted mt-6 text-center">Server: {serverUrl().replace(/^https?:\/\//, '')} · <button type="button" className="link" onClick={() => { setServerUrl(null); location.replace('/'); }}>Change</button></p>
          )}
        </div>
      </div>
    </div>
  );
}
