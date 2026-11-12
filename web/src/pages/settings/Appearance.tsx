import { useEffect, useState } from 'react';
import { Check, Download, Pencil, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { cls } from '@/lib/format';
import { PRESETS, applyTheme, resolveTheme, luminance, type ThemeColors, type ThemeData } from '@/lib/theme';
import { ColorInput, Modal, Range, Segmented, Select, Toggle } from '@/components/ui';
import { Card } from './Settings';

const COLOR_LABELS: [keyof ThemeColors, string][] = [
  ['primary', 'Primary'], ['onPrimary', 'Text on primary'], ['secondary', 'Secondary'], ['accent', 'Accent'], ['bg', 'Background'],
  ['surface', 'Surface'], ['surface2', 'Raised surface / inputs'], ['card', 'Cards'], ['border', 'Borders'], ['text', 'Text'], ['muted', 'Muted text'],
  ['hover', 'Hover tint'], ['selected', 'Selected state'],
];

export default function Appearance() {
  const { prefs, setPrefs, themes, reloadThemes, previewTheme } = useAuth();
  const toast = useToast();
  const activeId = prefs.appearance?.themeId ?? 'midnight';
  const current = resolveTheme(prefs.appearance, themes);
  const [draft, setDraft] = useState<ThemeData | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Live preview while editing; restore on unmount.
  useEffect(() => { previewTheme(draft); }, [draft, previewTheme]);
  useEffect(() => () => previewTheme(null), [previewTheme]);

  const startEdit = (base: ThemeData, id: string | null = null) => { setDraft(structuredClone(base)); setEditingId(id); };
  const set = (patch: Partial<ThemeData>) => setDraft((d) => ({ ...d!, ...patch }));
  const setColor = (k: keyof ThemeColors, v: string) => setDraft((d) => ({ ...d!, colors: { ...d!.colors, [k]: v }, dark: k === 'bg' ? luminance(v) < 0.4 : d!.dark }));
  const select = (id: string) => { setPrefs({ appearance: { themeId: id } }); setDraft(null); };

  const saveDraft = async () => {
    if (!draft) return;
    try {
      if (editingId) {
        const t = themes.find((x) => x.id === editingId)!;
        await api.put(`/settings/themes/${editingId}`, { name: t.name, data: draft });
        reloadThemes();
        setPrefs({ appearance: { themeId: editingId } });
      } else {
        const r = await api.post<{ id: string }>('/settings/themes', { name: name || 'My theme', data: draft });
        reloadThemes();
        setPrefs({ appearance: { themeId: r.id } });
      }
      setDraft(null); setSaveOpen(false); setName('');
      toast('Theme saved', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const exportTheme = (t: ThemeData, n: string) => {
    const blob = new Blob([JSON.stringify({ kimotoTheme: 1, name: n, data: t }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${n.replace(/\W+/g, '-').toLowerCase()}.kimoto-theme.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importTheme = async () => {
    try {
      const j = JSON.parse(importText);
      const data = j.data ?? j;
      if (!data.colors?.bg || !data.colors?.primary) throw new Error('Not a Kimoto theme file');
      const merged = { ...PRESETS.midnight.theme, ...data, colors: { ...PRESETS.midnight.theme.colors, ...data.colors } };
      const r = await api.post<{ id: string }>('/settings/themes', { name: j.name ?? 'Imported theme', data: merged });
      reloadThemes();
      setPrefs({ appearance: { themeId: r.id } });
      setImportOpen(false); setImportText('');
      toast('Theme imported', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const Swatch = ({ id, label, t, saved }: { id: string; label: string; t: ThemeData; saved?: boolean }) => (
    <div className={cls('rounded-lg border-2 overflow-hidden transition-colors', activeId === id && !draft ? 'border-primary' : 'border-border/60 hover:border-border')}>
      <button onClick={() => select(id)} className="block w-full text-left p-3" style={{ background: t.colors.bg, color: t.colors.text }} aria-pressed={activeId === id}>
        <div className="flex gap-1.5 mb-2.5">{[t.colors.primary, t.colors.secondary, t.colors.accent].map((c, i) => <span key={i} className="h-3.5 w-3.5 rounded-full" style={{ background: c }} />)}</div>
        <div className="rounded p-2 mb-2" style={{ background: t.colors.surface, border: `1px solid ${t.colors.border}`, borderRadius: t.radius / 2 }}>
          <div className="h-1.5 rounded w-3/4 mb-1" style={{ background: t.colors.text, opacity: 0.8 }} /><div className="h-1.5 rounded w-1/2" style={{ background: t.colors.muted }} />
        </div>
        <span className="text-xs font-medium flex items-center gap-1">{activeId === id && !draft && <Check className="h-3 w-3" />}{label}</span>
      </button>
      <div className="flex border-t" style={{ borderColor: t.colors.border, background: t.colors.surface }}>
        <button className="flex-1 h-7 text-[11px] inline-flex items-center justify-center gap-1" style={{ color: t.colors.muted }} onClick={() => startEdit(t, saved ? id : null)}><Pencil className="h-3 w-3" />{saved ? 'Edit' : 'Customize'}</button>
        <button className="h-7 w-8 inline-flex items-center justify-center" style={{ color: t.colors.muted }} onClick={() => exportTheme(t, label)} aria-label={`Export ${label}`}><Download className="h-3 w-3" /></button>
        {saved && <button className="h-7 w-8 inline-flex items-center justify-center" style={{ color: t.colors.muted }} aria-label={`Delete ${label}`} onClick={() => confirm(`Delete “${label}”?`) && api.del(`/settings/themes/${id}`).then(() => { reloadThemes(); if (activeId === id) select('midnight'); })}><Trash2 className="h-3 w-3" /></button>}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display text-2xl font-bold">Appearance & themes</h1>
        <button className="btn-outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Import</button>
      </div>

      {draft ? (
        <div className="grid xl:grid-cols-[1fr_280px] gap-5">
          <div>
            <Card title={editingId ? `Editing “${themes.find((t) => t.id === editingId)?.name}”` : 'Custom theme'} description="Changes preview live across the whole app.">
              <div className="grid sm:grid-cols-2 gap-x-6">{COLOR_LABELS.map(([k, l]) => <ColorInput key={k} label={l} value={draft.colors[k]} onChange={(v) => setColor(k, v)} />)}</div>
            </Card>
            <Card title="Shape & depth">
              <Range label="Corner radius" value={draft.radius} min={0} max={24} onChange={(radius) => set({ radius })} format={(v) => `${v}px`} />
              <Range label="Shadows" value={draft.shadow} min={0} max={1.5} step={0.1} onChange={(shadow) => set({ shadow })} />
              <Range label="Surface transparency" value={draft.transparency} min={0} max={0.6} step={0.05} onChange={(transparency) => set({ transparency })} format={(v) => `${Math.round(v * 100)}%`} />
              <Range label="Glass blur" value={draft.blur} min={0} max={24} onChange={(blur) => set({ blur })} format={(v) => (v ? `${v}px` : 'Off')} />
              {draft.blur > 12 && <p className="text-xs text-warning">Heavy blur can slow down older devices.</p>}
            </Card>
            <Card title="Background gradient">
              <Toggle label="Enable gradient" checked={draft.gradient.enabled} onChange={(enabled) => set({ gradient: { ...draft.gradient, enabled } })} />
              {draft.gradient.enabled && <>
                <div className="grid sm:grid-cols-2 gap-x-6"><ColorInput label="From" value={draft.gradient.from} onChange={(from) => set({ gradient: { ...draft.gradient, from } })} /><ColorInput label="To" value={draft.gradient.to} onChange={(to) => set({ gradient: { ...draft.gradient, to } })} /></div>
                <Range label="Angle" value={draft.gradient.angle} min={0} max={360} onChange={(angle) => set({ gradient: { ...draft.gradient, angle } })} format={(v) => `${v}°`} />
                <Range label="Strength" value={draft.gradient.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => set({ gradient: { ...draft.gradient, opacity } })} format={(v) => `${Math.round(v * 100)}%`} />
              </>}
            </Card>
            <Card title="Typography, spacing & motion">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><span className="label">Font</span><Select value={draft.font} onChange={(font) => set({ font })} options={['Inter', 'System', 'Space Grotesk', 'Literata', 'Atkinson'].map((f) => ({ value: f as ThemeData['font'], label: f === 'Atkinson' ? 'Atkinson Hyperlegible' : f }))} /></div>
                <Range label="Base font size" value={draft.fontSize} min={13} max={20} onChange={(fontSize) => set({ fontSize })} format={(v) => `${v}px`} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>Spacing</span><Segmented size="sm" value={draft.density} onChange={(density) => set({ density })} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }]} /></div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>Animations</span><Segmented size="sm" value={draft.animations} onChange={(animations) => set({ animations })} options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'none', label: 'None' }]} /></div>
            </Card>
          </div>
          <div className="xl:sticky xl:top-20 self-start space-y-3">
            <Preview />
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={() => (editingId ? saveDraft() : setSaveOpen(true))}>{editingId ? 'Save changes' : 'Save theme'}</button>
              <button className="btn-outline" onClick={() => { setPrefs({ appearance: { themeId: 'custom', custom: draft } }); setDraft(null); }} title="Apply without saving to your theme list">Apply</button>
              <button className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <Card title="Theme presets">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{Object.entries(PRESETS).map(([id, p]) => <Swatch key={id} id={id} label={p.name} t={p.theme} />)}</div>
          </Card>
          <Card title="Your themes" description="Create themes from any preset, save as many as you like, and share them as files.">
            {!themes.length && activeId !== 'custom' ? <p className="text-sm text-muted">No saved themes yet — click “Customize” on a preset to start.</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {themes.map((t) => <Swatch key={t.id} id={t.id} label={t.name} t={{ ...PRESETS.midnight.theme, ...t.data }} saved />)}
                {activeId === 'custom' && prefs.appearance?.custom && <Swatch id="custom" label="Custom (unsaved)" t={{ ...PRESETS.midnight.theme, ...prefs.appearance.custom }} />}
              </div>
            )}
            <button className="btn-outline mt-4" onClick={() => startEdit(current)}><Pencil className="h-4 w-4" />Customize current theme</button>
          </Card>
        </>
      )}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save theme" footer={<button className="btn-primary" onClick={saveDraft}>Save</button>}>
        <input className="input" autoFocus placeholder="Theme name" value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import theme" footer={<button className="btn-primary" disabled={!importText} onClick={importTheme}>Import</button>}>
        <label className="btn-outline cursor-pointer mb-3">Choose file<input type="file" accept=".json,application/json" className="hidden" onChange={async (e) => setImportText(await e.target.files?.[0]?.text() ?? '')} /></label>
        <textarea className="textarea font-mono text-xs" rows={8} placeholder="…or paste theme JSON" value={importText} onChange={(e) => setImportText(e.target.value)} />
      </Modal>
    </>
  );
}

/** A small mock of app UI rendered with the live theme. */
function Preview() {
  return (
    <div className="panel p-4 space-y-3" aria-label="Theme preview">
      <div className="text-xs text-muted">Preview</div>
      <div className="flex gap-3">
        <div className="w-16 aspect-[2/3] rounded bg-gradient-to-br from-primary to-accent shadow-card" />
        <div className="flex-1 min-w-0">
          <div className="font-display font-semibold">Lanterns Over Kirihara</div>
          <div className="text-xs text-muted">Fantasy · Adventure</div>
          <div className="flex gap-1.5 mt-2"><span className="chip-on h-6">Reading</span><span className="chip h-6">Folklore</span></div>
        </div>
      </div>
      <div className="card p-3 text-sm">A card with <a className="link">a link</a> and <span className="text-muted">muted text</span>.</div>
      <input className="input" placeholder="Input field" readOnly />
      <div className="flex gap-2"><button className="btn-primary h-8">Primary</button><button className="btn-outline h-8">Outline</button><button className="btn-ghost h-8">Ghost</button></div>
      <div className="flex gap-2 text-xs"><span className="text-secondary">Secondary</span><span className="text-accent">Accent</span><span className="text-success">Success</span><span className="text-danger">Danger</span></div>
    </div>
  );
}

