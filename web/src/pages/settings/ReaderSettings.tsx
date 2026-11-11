import { useState } from 'react';
import { useAuth } from '@/hooks/app';
import { TYPE_LABEL } from '@/lib/format';
import { DEFAULT_NOVEL, DEFAULT_READER, novelProfile, readerProfile, NOVEL_THEMES } from '@/lib/prefs';
import { Range, Segmented, Select, Tabs, Toggle } from '@/components/ui';
import { Card } from './Settings';

const LANGS = [['en', 'English'], ['es', 'Spanish'], ['es-la', 'Spanish (LATAM)'], ['pt-br', 'Portuguese (BR)'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ru', 'Russian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese (Simplified)'], ['zh-hk', 'Chinese (Traditional)']];

export default function ReaderSettings() {
  const { prefs, setPrefs } = useAuth();
  const [type, setType] = useState<'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'novel'>('manga');
  const p = type === 'novel' ? null : readerProfile(prefs, type);
  const n = novelProfile(prefs);
  const set = (patch: object) => setPrefs({ reader: { profiles: { [type]: patch } } });
  const langs: string[] = prefs.chapterLanguages ?? ['en'];
  return (
    <>
      <h1 className="font-display text-2xl font-bold mb-5">Reader</h1>
      <Card title="General">
        <Toggle label="Add titles to my library when I start reading" checked={prefs.reader?.autoAddToLibrary !== false} onChange={(v) => setPrefs({ reader: { autoAddToLibrary: v } })} />
        <div className="mt-2">
          <span className="label">Chapter languages (in order of preference)</span>
          <div className="flex flex-wrap gap-1.5">{LANGS.map(([code, label]) => {
            const on = langs.includes(code);
            return <button key={code} className={on ? 'chip-on' : 'chip'} onClick={() => setPrefs({ chapterLanguages: on ? langs.filter((l) => l !== code).length ? langs.filter((l) => l !== code) : langs : [...langs, code] })}>{on && `${langs.indexOf(code) + 1}. `}{label}</button>;
          })}</div>
        </div>
      </Card>
      <Tabs value={type} onChange={setType} className="mb-4" tabs={(['manga', 'manhwa', 'manhua', 'webtoon', 'novel'] as const).map((t) => ({ id: t, label: TYPE_LABEL[t] }))} />
      <p className="text-sm text-muted mb-4">Each content type keeps its own reader profile. You can also change these from inside the reader.</p>
      {p ? (
        <>
          <Card title="Layout">
            <div className="space-y-4">
              <div><span className="label">Reading mode</span><Segmented value={p.mode} onChange={(mode) => set({ mode })} options={[{ value: 'paged', label: 'Single page' }, { value: 'double', label: 'Double page' }, { value: 'vertical', label: 'Vertical scroll' }, { value: 'webtoon', label: 'Webtoon (continuous)' }]} /></div>
              <div><span className="label">Reading direction (paged modes)</span><Segmented value={p.direction} onChange={(direction) => set({ direction })} options={[{ value: 'rtl', label: 'Right to left' }, { value: 'ltr', label: 'Left to right' }]} /></div>
              <div><span className="label">Image scaling</span><Segmented value={p.fit} onChange={(fit) => set({ fit })} options={[{ value: 'screen', label: 'Fit screen' }, { value: 'width', label: 'Fit width' }, { value: 'height', label: 'Fit height' }, { value: 'original', label: 'Original size' }]} /></div>
              <div><span className="label">Page transition</span><Segmented value={p.transition} onChange={(transition) => set({ transition })} options={[{ value: 'slide', label: 'Slide' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }]} /></div>
              <Range label="Page margins" value={p.margins} min={0} max={80} onChange={(margins) => set({ margins })} format={(v) => `${v}px`} />
              <Range label="Page spacing (vertical)" value={p.spacing} min={0} max={60} onChange={(spacing) => set({ spacing })} format={(v) => `${v}px`} />
              <Range label="Scroll / auto-scroll speed" value={p.scrollSpeed} min={100} max={1500} step={50} onChange={(scrollSpeed) => set({ scrollSpeed })} />
              <Range label="Pages to preload" value={p.preload} min={0} max={10} onChange={(preload) => set({ preload })} />
            </div>
          </Card>
          <Card title="Look">
            <div className="flex items-center justify-between py-2 text-sm"><span>Background</span><input type="color" value={p.background} onChange={(e) => set({ background: e.target.value })} /></div>
            <Range label="Brightness overlay" value={p.brightness} min={0} max={0.8} step={0.05} onChange={(brightness) => set({ brightness })} format={(v) => `${Math.round(v * 100)}% darker`} />
            <div className="flex items-center justify-between py-2 text-sm"><span>Toolbar</span><Segmented size="sm" value={p.toolbar} onChange={(toolbar) => set({ toolbar })} options={[{ value: 'auto', label: 'Auto-hide' }, { value: 'always', label: 'Always' }, { value: 'hidden', label: 'Hidden' }]} /></div>
            <Toggle label="Immersive mode" description="Open chapters with all controls hidden." checked={p.immersive} onChange={(immersive) => set({ immersive })} />
            <Toggle label="Progress line" checked={p.showProgress} onChange={(showProgress) => set({ showProgress })} />
          </Card>
          <Card title="Controls & chapters">
            <Toggle label="Tap zones" description="Edges turn pages; the center toggles controls." checked={p.tapZones} onChange={(tapZones) => set({ tapZones })} />
            <Toggle label="Automatic chapter progression" checked={p.autoNext} onChange={(autoNext) => set({ autoNext })} />
            <div className="flex items-center justify-between py-2 text-sm"><span>Chapter transition</span><Segmented size="sm" value={p.chapterTransition} onChange={(chapterTransition) => set({ chapterTransition })} options={[{ value: 'confirm', label: 'Show next-chapter card' }, { value: 'auto', label: 'Continue automatically' }]} /></div>
            <Toggle label="Data saver images" checked={p.dataSaver} onChange={(dataSaver) => set({ dataSaver })} />
            <button className="btn-ghost text-sm mt-2" onClick={() => setPrefs({ reader: { profiles: { [type]: DEFAULT_READER[type as keyof typeof DEFAULT_READER] } } })}>Reset {TYPE_LABEL[type]} profile</button>
          </Card>
        </>
      ) : (
        <Card title="Light novel reader">
          <div className="space-y-3">
            <div><span className="label">Theme</span><Segmented value={n.theme} onChange={(theme) => set({ theme })} options={[...Object.keys(NOVEL_THEMES).map((k) => ({ value: k as any, label: k[0].toUpperCase() + k.slice(1) })), { value: 'custom', label: 'Custom' }]} /></div>
            {n.theme === 'custom' && <div className="flex gap-6 text-sm"><label className="flex items-center gap-2">Text <input type="color" value={n.textColor} onChange={(e) => set({ textColor: e.target.value })} /></label><label className="flex items-center gap-2">Background <input type="color" value={n.background} onChange={(e) => set({ background: e.target.value })} /></label></div>}
            <div className="max-w-xs"><span className="label">Font</span><Select value={n.font} onChange={(font) => set({ font })} options={['Literata', 'Georgia', 'Inter', 'Atkinson', 'System'].map((f) => ({ value: f as any, label: f }))} /></div>
            <Range label="Font size" value={n.fontSize} min={13} max={32} onChange={(fontSize) => set({ fontSize })} format={(v) => `${v}px`} />
            <Range label="Line height" value={n.lineHeight} min={1.2} max={2.4} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
            <Range label="Line width" value={n.width} min={40} max={110} onChange={(width) => set({ width })} format={(v) => `${v} characters`} />
            <Range label="Paragraph spacing" value={n.paragraphSpacing} min={0} max={2.5} step={0.1} onChange={(paragraphSpacing) => set({ paragraphSpacing })} format={(v) => `${v}em`} />
            <Range label="Brightness overlay" value={n.brightness} min={0} max={0.8} step={0.05} onChange={(brightness) => set({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="flex items-center justify-between py-1 text-sm"><span>Alignment</span><Segmented size="sm" value={n.align} onChange={(align) => set({ align })} options={[{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justified' }]} /></div>
            <Toggle label="Indent paragraphs" checked={n.indent} onChange={(indent) => set({ indent })} />
            <Toggle label="Automatic chapter progression" checked={n.autoNext} onChange={(autoNext) => set({ autoNext })} />
            <div className="rounded-lg p-5 mt-2" style={{ background: n.theme === 'custom' ? n.background : NOVEL_THEMES[n.theme].bg, color: n.theme === 'custom' ? n.textColor : NOVEL_THEMES[n.theme].fg, fontFamily: n.font === 'System' ? 'system-ui' : `'${n.font}', Georgia, serif`, fontSize: n.fontSize, lineHeight: n.lineHeight, textAlign: n.align }}>
              The first map Ilse ever drew was of a room she had never seen. She was nine, and the paper was the back of a bakery receipt.
            </div>
            <button className="btn-ghost text-sm" onClick={() => setPrefs({ reader: { profiles: { novel: DEFAULT_NOVEL } } })}>Reset light novel profile</button>
          </div>
        </Card>
      )}
    </>
  );
}
