import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { duration, tz } from '@/lib/format';
import { ErrorState, PageLoader, Select } from '@/components/ui';

const GRADIENTS = [
  'from-[#6a11cb] to-[#2575fc]', 'from-[#ff512f] to-[#dd2476]', 'from-[#11998e] to-[#38ef7d]', 'from-[#fc4a1a] to-[#f7b733]',
  'from-[#8e2de2] to-[#4a00e0]', 'from-[#00b4db] to-[#0083b0]', 'from-[#ee0979] to-[#ff6a00]', 'from-[#1d2b64] to-[#f8cdda]',
];
const cover = (url: string | null, _source?: string) => url; // already proxied by the server
const hourLabel = (h: number) => (h === 0 ? 'midnight' : h < 12 ? `${h} AM` : h === 12 ? 'noon' : `${h - 12} PM`);

export default function Wrapped() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [i, setI] = useState(0);
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['wrapped', year], queryFn: () => api.get<any>(`/stats/wrapped?year=${year}&tz=${enc(tz())}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const w = q.data;
  const years = [...new Set([new Date().getFullYear(), ...w.availableYears])].sort((a, b) => b - a);
  const empty = w.totals.chapters === 0;

  const slides = empty ? [
    <Slide key="e" g={0}><p className="text-lg opacity-80">{year}</p><h2 className="text-4xl font-bold mt-2">Your story starts here</h2><p className="mt-4 opacity-80">Read a few chapters this year and your Wrapped will fill itself in — every number comes from your real reading.</p></Slide>,
  ] : [
    <Slide key="intro" g={0}><p className="text-lg opacity-80">{user?.displayName}'s</p><h2 className="text-6xl font-black mt-1 tracking-tight">{year}</h2><p className="text-2xl font-semibold mt-1">in reading</p><p className="mt-8 opacity-80">Tap through to see your year.</p></Slide>,
    <Slide key="time" g={1}><p className="opacity-80">You spent</p><h2 className="text-5xl font-black mt-2">{duration(w.totals.seconds)}</h2><p className="text-xl mt-2">reading this year</p><p className="mt-6 opacity-80">across {w.totals.sessions} sessions on {w.totals.activeDays} different days.</p></Slide>,
    <Slide key="ch" g={2}><h2 className="text-6xl font-black">{w.totals.chapters.toLocaleString()}</h2><p className="text-xl mt-2">chapters read</p><p className="mt-6 text-lg">from <b>{w.totals.titles}</b> different titles,<br />and you finished <b>{w.totals.completed}</b> of them.</p></Slide>,
    w.topGenres.length > 0 && <Slide key="genres" g={3}><p className="opacity-80">Your top genres</p><ol className="mt-4 space-y-2 text-left">{w.topGenres.map((g: any, n: number) => <li key={g.genre} className="flex items-baseline gap-3"><span className="text-3xl font-black w-8 opacity-70">{n + 1}</span><span className="text-2xl font-bold flex-1">{g.genre}</span><span className="opacity-80">{g.chapters} ch.</span></li>)}</ol>
      {w.newGenres.length > 0 && <p className="mt-6 text-sm opacity-90">New this year: {w.newGenres.join(', ')}</p>}</Slide>,
    w.topTitles.length > 0 && <Slide key="titles" g={4}><p className="opacity-80">You couldn't put these down</p><ol className="mt-4 space-y-3 text-left">{w.topTitles.map((t: any, n: number) => (
      <li key={t.titleId} className="flex items-center gap-3">{cover(t.coverUrl, t.source) ? <img src={cover(t.coverUrl, t.source)!} alt="" className="h-14 w-10 rounded object-cover shadow-lg" /> : <span className="h-14 w-10 rounded bg-white/20" />}
        <span className="flex-1 min-w-0"><span className="block font-bold truncate">{n + 1}. {t.title}</span><span className="text-sm opacity-80">{t.chapters} chapters</span></span></li>))}</ol></Slide>,
    <Slide key="when" g={5}>
      {w.topMonth && <><p className="opacity-80">Your biggest month was</p><h2 className="text-4xl font-black mt-1">{new Date(`${w.topMonth[0]}-15`).toLocaleDateString(undefined, { month: 'long' })}</h2><p className="mt-1">{w.topMonth[1]} chapters</p></>}
      <div className="flex items-end gap-1 h-24 mt-6 justify-center" aria-hidden>{w.months.map((m: any) => { const max = Math.max(1, ...w.months.map((x: any) => x.chapters)); return <div key={m.month} className="w-4 rounded-t bg-white/80" style={{ height: `${Math.max(4, (m.chapters / max) * 100)}%` }} />; })}</div>
      {w.topHour != null && <p className="mt-6 text-lg">You read most around <b>{hourLabel(w.topHour)}</b>.</p>}
      <p className="mt-2">Longest streak: <b>{w.longestStreak} days</b> in a row.</p></Slide>,
    <Slide key="persona" g={6}><p className="opacity-80">Your reader personality</p><h2 className="text-5xl font-black mt-3">{w.persona}</h2>
      {w.firstRead && <p className="mt-8 opacity-90">It all started with <b>{w.firstRead.title}</b> on {new Date(w.firstRead.at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.</p>}</Slide>,
    w.completedTitles.length > 0 && <Slide key="done" g={7}><p className="opacity-80">Finished in {year}</p><div className="grid grid-cols-4 gap-2 mt-4">{w.completedTitles.slice(0, 12).map((t: any) => cover(t.coverUrl, t.source) ? <img key={t.titleId} src={cover(t.coverUrl, t.source)!} alt={t.title} title={t.title} className="aspect-[2/3] w-full rounded object-cover shadow-lg" /> : <div key={t.titleId} className="aspect-[2/3] rounded bg-white/20 text-[10px] p-1">{t.title}</div>)}</div></Slide>,
  ].filter(Boolean) as JSX.Element[];
  const cur = Math.min(i, slides.length - 1);

  const share = () => {
    const text = `My ${year} on Kimoto: ${duration(w.totals.seconds)} reading, ${w.totals.chapters} chapters, ${w.totals.completed} titles finished. Top genres: ${w.topGenres.map((g: any) => g.genre).slice(0, 3).join(', ')}. Persona: ${w.persona}.`;
    navigator.clipboard.writeText(text).then(() => toast('Summary copied', 'success'));
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Link to="/stats" className="btn-ghost"><ArrowLeft className="h-4 w-4" />Statistics</Link>
        <div className="flex gap-2"><Select className="w-28" label="Year" value={String(year)} onChange={(v) => { setYear(Number(v)); setI(0); }} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          {!empty && <button className="btn-outline" onClick={share}><Copy className="h-4 w-4" />Share</button>}</div>
      </div>
      <div className="flex gap-1 mb-3">{slides.map((_, n) => <button key={n} onClick={() => setI(n)} aria-label={`Slide ${n + 1}`} className={`h-1 flex-1 rounded-full ${n <= cur ? 'bg-primary' : 'bg-border'}`} />)}</div>
      <div className="relative select-none">
        {slides[cur]}
        <button className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous" onClick={() => setI(Math.max(0, cur - 1))} />
        <button className="absolute inset-y-0 right-0 w-2/3" aria-label="Next" onClick={() => setI(Math.min(slides.length - 1, cur + 1))} />
      </div>
      <div className="flex justify-between mt-3">
        <button className="btn-ghost" disabled={cur === 0} onClick={() => setI(cur - 1)}><ChevronLeft className="h-4 w-4" />Back</button>
        <button className="btn-ghost" disabled={cur === slides.length - 1} onClick={() => setI(cur + 1)}>Next<ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Slide({ g, children }: { g: number; children: React.ReactNode }) {
  return <div className={`aspect-[9/16] max-h-[75vh] w-full rounded-2xl bg-gradient-to-br ${GRADIENTS[g % GRADIENTS.length]} text-white p-8 flex flex-col justify-center text-center shadow-card overflow-hidden`}>{children}</div>;
}
