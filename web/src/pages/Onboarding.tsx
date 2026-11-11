import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/app';
import { GENRES, TYPE_LABEL, cls } from '@/lib/format';
import { PRESETS } from '@/lib/theme';
import { NOVEL_THEMES } from '@/lib/prefs';
import { Segmented, Select, Toggle } from '@/components/ui';
import type { ContentType } from '@/lib/types';
import { subscribePush } from './settings/Notifications';

const STEPS = ['Welcome', 'Account', 'Content', 'Genres', 'Reading', 'Trackers', 'Notifications', 'Privacy', 'Theme', 'Done'];
const LANGS = [['en', 'English'], ['es', 'Spanish'], ['es-la', 'Spanish (LATAM)'], ['pt-br', 'Portuguese (BR)'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ru', 'Russian'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];

export default function Onboarding() {
  const { user, prefs, setPrefs, refresh } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [profilePublic, setProfilePublic] = useState(true);
  const types: ContentType[] = prefs.contentTypes ?? ['manga', 'manhwa', 'manhua', 'webtoon', 'novel'];
  const genres: string[] = prefs.favoriteGenres ?? [];
  const mangaProfile = prefs.reader?.profiles?.manga ?? {};

  const finish = async () => {
    setPrefs({ onboarded: true });
    await api.patch('/settings/prefs', { onboarded: true });
    await api.patch('/me/profile', { isPublic: profilePublic, favoriteGenres: genres }).catch(() => undefined);
    await refresh();
    nav('/', { replace: true });
  };
  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1));
  const optional = step >= 2 && step <= 8;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1 bg-surface-2"><div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="flex-1 flex items-start sm:items-center justify-center p-5">
        <div className="w-full max-w-2xl">
          <p className="text-xs text-muted mb-2">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>

          {step === 0 && (
            <div>
              <Sparkles className="h-10 w-10 text-primary mb-4" />
              <h1 className="font-display text-3xl font-bold">Welcome to Kimoto</h1>
              <p className="text-muted mt-3 leading-relaxed">Let's tune Kimoto to how you read. It takes about a minute, and you can skip anything and change it later in Settings.</p>
            </div>
          )}
          {step === 1 && (
            <div>
              <h1 className="font-display text-2xl font-bold">You're signed in</h1>
              <p className="text-muted mt-2">Signed in as <b className="text-fg">{user?.displayName}</b> (@{user?.username}). Your library, progress and settings sync across every device you use.</p>
            </div>
          )}
          {step === 2 && (
            <Picker title="What do you like to read?" subtitle="We'll prioritize these in discovery and recommendations."
              options={(Object.keys(TYPE_LABEL) as ContentType[]).map((t) => ({ id: t, label: TYPE_LABEL[t] }))}
              selected={types} onChange={(v) => setPrefs({ contentTypes: v })} />
          )}
          {step === 3 && (
            <Picker title="Pick some favorite genres" subtitle="Choose as many as you like." options={[...GENRES, 'Isekai', 'Historical', 'Martial Arts', 'Mecha', 'School Life', 'Music', 'Cooking'].map((g) => ({ id: g, label: g }))}
              selected={genres} onChange={(v) => setPrefs({ favoriteGenres: v })} />
          )}
          {step === 4 && (
            <div className="space-y-5">
              <h1 className="font-display text-2xl font-bold">Reading preferences</h1>
              <div><span className="label">Manga reading direction</span><Segmented value={mangaProfile.direction ?? 'rtl'} onChange={(v) => setPrefs({ reader: { profiles: { manga: { direction: v } } } })} options={[{ value: 'rtl', label: 'Right to left (Japanese)' }, { value: 'ltr', label: 'Left to right' }]} /></div>
              <div><span className="label">Default manga mode</span><Segmented value={mangaProfile.mode ?? 'paged'} onChange={(v) => setPrefs({ reader: { profiles: { manga: { mode: v } } } })} options={[{ value: 'paged', label: 'Single page' }, { value: 'double', label: 'Double page' }, { value: 'vertical', label: 'Vertical scroll' }]} /></div>
              <div><span className="label">Light novel theme</span><Segmented value={prefs.reader?.profiles?.novel?.theme ?? 'dark'} onChange={(v) => setPrefs({ reader: { profiles: { novel: { theme: v } } } })} options={Object.keys(NOVEL_THEMES).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} /></div>
              <div className="max-w-xs"><span className="label">Preferred chapter language</span>
                <Select value={prefs.chapterLanguages?.[0] ?? 'en'} onChange={(v) => setPrefs({ chapterLanguages: [v], language: v })} options={LANGS.map(([value, label]) => ({ value, label }))} /></div>
              <p className="text-xs text-muted">Webtoons, manhwa and manhua default to vertical scrolling. Every content type has its own reader profile in Settings.</p>
            </div>
          )}
          {step === 5 && (
            <div>
              <h1 className="font-display text-2xl font-bold">Connect MyAnimeList or AniList</h1>
              <p className="text-muted mt-2">Import your existing list and keep progress in sync automatically. Kimoto asks before overwriting anything.</p>
              <div className="flex flex-wrap gap-3 mt-5">
                <a href="/api/integrations/anilist/connect" className="btn-outline h-11 px-5">Connect AniList</a>
                <a href="/api/integrations/mal/connect" className="btn-outline h-11 px-5">Connect MyAnimeList</a>
              </div>
              <p className="text-xs text-muted mt-3">You'll come back to Settings after authorizing; finish setup from there or continue here now.</p>
            </div>
          )}
          {step === 6 && (
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold mb-3">Notifications</h1>
              {([['chapter', 'New chapters for titles in your library'], ['friend', 'Friend requests'], ['message', 'Direct messages'], ['reply', 'Replies to your comments'], ['community', 'Community activity on your posts and lists']] as const).map(([k, l]) => (
                <Toggle key={k} label={l} checked={prefs.notifications?.categories?.[k] !== false} onChange={(v) => setPrefs({ notifications: { categories: { [k]: v } } })} />
              ))}
              <div className="pt-3 flex flex-wrap gap-2">
                <button className="btn-outline" onClick={async () => { if ('Notification' in window) { const p = await Notification.requestPermission(); setPrefs({ notifications: { browser: p === 'granted' } }); } }}>Allow browser notifications</button>
                <button className="btn-outline" onClick={async () => { const ok = await subscribePush(); setPrefs({ notifications: { push: ok } }); }}>Enable push on this device</button>
              </div>
            </div>
          )}
          {step === 7 && (
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold mb-3">Privacy</h1>
              <Toggle label="Public profile" description="Anyone can see your profile. Turn off to show it only to friends." checked={profilePublic} onChange={setProfilePublic} />
              <Toggle label="Appear in rankings" checked={prefs.privacy?.showInRankings !== false} onChange={(v) => setPrefs({ privacy: { showInRankings: v } })} />
              <Toggle label="Share activity with friends" description="Completions, ratings and new lists appear in friends' feeds." checked={prefs.privacy?.showActivityInFeed !== false} onChange={(v) => setPrefs({ privacy: { showActivityInFeed: v } })} />
              <Toggle label="Record reading statistics" description="Measures active reading time to power your stats. You can delete history anytime." checked={prefs.analytics?.enabled !== false} onChange={(v) => setPrefs({ analytics: { enabled: v } })} />
              <div className="pt-2 max-w-xs"><span className="label">Who can message you</span>
                <Select value={prefs.privacy?.allowMessages ?? 'everyone'} onChange={(v) => setPrefs({ privacy: { allowMessages: v } })} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'friends', label: 'Friends only' }, { value: 'none', label: 'No one' }]} /></div>
            </div>
          )}
          {step === 8 && (
            <div>
              <h1 className="font-display text-2xl font-bold mb-4">Pick a theme</h1>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(PRESETS).map(([id, p]) => (
                  <button key={id} onClick={() => setPrefs({ appearance: { themeId: id } })}
                    className={cls('rounded-lg border-2 p-3 text-left transition-colors', (prefs.appearance?.themeId ?? 'midnight') === id ? 'border-primary' : 'border-transparent hover:border-border')}
                    style={{ background: p.theme.colors.bg, color: p.theme.colors.text }}>
                    <div className="flex gap-1.5 mb-3">{[p.theme.colors.primary, p.theme.colors.secondary, p.theme.colors.accent].map((c) => <span key={c} className="h-4 w-4 rounded-full" style={{ background: c }} />)}</div>
                    <div className="h-2 rounded mb-1.5" style={{ background: p.theme.colors.surface2, width: '80%' }} />
                    <div className="h-2 rounded mb-3" style={{ background: p.theme.colors.surface2, width: '55%' }} />
                    <span className="text-sm font-medium">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 9 && (
            <div>
              <Check className="h-10 w-10 text-success mb-4" />
              <h1 className="font-display text-3xl font-bold">You're all set</h1>
              <p className="text-muted mt-3">Your dashboard is ready. Press <kbd className="border border-border rounded px-1.5 text-xs">Ctrl K</kbd> anytime to search or jump anywhere.</p>
            </div>
          )}

          <div className="flex items-center gap-3 mt-10">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" />Back</button>}
            <div className="flex-1" />
            {optional && <button className="btn-ghost text-muted" onClick={() => setStep(step + 1)}>Skip</button>}
            <button className="btn-primary h-10 px-5" onClick={next}>{step === STEPS.length - 1 ? 'Enter Kimoto' : 'Continue'}<ArrowRight className="h-4 w-4" /></button>
          </div>
          {step < 9 && <button className="text-xs text-muted hover:text-fg mt-6" onClick={finish}>Skip setup entirely</button>}
        </div>
      </div>
    </div>
  );
}

function Picker({ title, subtitle, options, selected, onChange }: { title: string; subtitle: string; options: { id: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="text-muted mt-1 mb-5">{subtitle}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.id);
          return <button key={o.id} aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])} className={cls(on ? 'chip-on' : 'chip', 'h-9 px-4 text-sm')}>{on && <Check className="h-3.5 w-3.5" />}{o.label}</button>;
        })}
      </div>
    </div>
  );
}
