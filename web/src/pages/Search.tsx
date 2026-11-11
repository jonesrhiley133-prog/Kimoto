import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search as SearchIcon, X, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/hooks/app';
import { GENRES, TYPE_LABEL, cls } from '@/lib/format';
import type { ContentType, Title } from '@/lib/types';
import { ErrorState, Select, Spinner, useDebounced } from '@/components/ui';
import { GridSkeleton, TitleCard, TitleGrid } from '@/components/titles';

interface Filters {
  query: string; source: string; types: string[]; genres: string[]; excludeGenres: string[]; demographic: string[]; status: string[];
  yearFrom: string; yearTo: string; language: string; author: string; minRating: string; contentRating: string[]; sort: string;
}
const EMPTY: Filters = { query: '', source: 'all', types: [], genres: [], excludeGenres: [], demographic: [], status: [], yearFrom: '', yearTo: '', language: '', author: '', minRating: '', contentRating: [], sort: '' };
const ARR: (keyof Filters)[] = ['types', 'genres', 'excludeGenres', 'demographic', 'status', 'contentRating'];

function fromParams(p: URLSearchParams): Filters {
  const f: any = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Filters)[]) {
    const v = p.get(k);
    if (v) f[k] = ARR.includes(k) ? v.split(',') : v;
  }
  return f;
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<Filters>(() => fromParams(params));
  const [showFilters, setShowFilters] = useState(false);
  const { prefs } = useAuth();
  const debounced = useDebounced(f, 350);
  // Mirror filters into the URL so searches are shareable and survive reloads.
  useEffect(() => { setParams(new URLSearchParams(qs({ ...debounced, source: debounced.source === 'all' ? '' : debounced.source }).slice(1)), { replace: true }); }, [debounced, setParams]);

  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get<{ id: string; name: string; enabled: boolean; capabilities: any }[]>('/sources') });
  const genreSource = f.source !== 'all' ? f.source : sources.data?.find((s) => s.enabled && s.id === 'anilist') ? 'anilist' : 'mangadex';
  const genres = useQuery({ queryKey: ['genres', genreSource], queryFn: () => api.get<string[]>(`/sources/${genreSource}/genres`), staleTime: 3600_000, retry: false });
  const genreList = useMemo(() => [...new Set([...(genres.data ?? []), ...GENRES])].sort(), [genres.data]);

  const res = useInfiniteQuery({
    queryKey: ['search', debounced],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<{ items: Title[]; hasMore: boolean; errors: { source: string; error: string }[]; total: number }>(`/search${qs({ ...debounced, limit: 24, offset: pageParam })}`),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * 24 : undefined),
  });
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const errors = res.data?.pages[0]?.errors ?? [];
  const toggle = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: (x[k] as string[]).includes(v) ? (x[k] as string[]).filter((y) => y !== v) : [...(x[k] as string[]), v] }));
  const cycleGenre = (g: string) => setF((x) => x.genres.includes(g) ? { ...x, genres: x.genres.filter((y) => y !== g), excludeGenres: [...x.excludeGenres, g] }
    : x.excludeGenres.includes(g) ? { ...x, excludeGenres: x.excludeGenres.filter((y) => y !== g) } : { ...x, genres: [...x.genres, g] });
  const activeCount = ARR.reduce((n, k) => n + (f[k] as string[]).length, 0) + ['yearFrom', 'yearTo', 'language', 'author', 'minRating'].filter((k) => f[k as keyof Filters]).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-4">Advanced search</h1>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus className="input h-11 pl-9 text-base" placeholder="Title or alternative title…" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} aria-label="Search query" />
        </div>
        <button className={cls(showFilters ? 'btn-primary' : 'btn-outline', 'h-11')} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
          <SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Filters</span>{activeCount > 0 && <span className="rounded-full bg-accent text-white text-[11px] px-1.5">{activeCount}</span>}
        </button>
      </div>

      {showFilters && (
        <div className="panel p-4 mb-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><span className="label">Source</span><Select value={f.source} onChange={(v) => setF({ ...f, source: v })} options={[{ value: 'all', label: 'All enabled sources' }, ...(sources.data ?? []).filter((s) => s.capabilities.search).map((s) => ({ value: s.id, label: s.name }))]} /></div>
            <div><span className="label">Sort by</span><Select value={f.sort} onChange={(v) => setF({ ...f, sort: v })} options={[{ value: '', label: 'Best match' }, { value: 'popular', label: 'Popularity' }, { value: 'rating', label: 'Rating' }, { value: 'latest', label: 'Latest update' }, { value: 'newest', label: 'Newest' }, { value: 'follows', label: 'Most followed' }, { value: 'title', label: 'Title A–Z' }]} /></div>
            <label><span className="label">Author or artist</span><input className="input" value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
            <div><span className="label">Chapter language</span><Select value={f.language} onChange={(v) => setF({ ...f, language: v })} options={[{ value: '', label: 'Any' }, ...['en', 'es-la', 'pt-br', 'fr', 'de', 'it', 'ru', 'id', 'vi', 'ja', 'ko', 'zh'].map((l) => ({ value: l, label: l }))]} /></div>
            <label><span className="label">Year from</span><input type="number" className="input" min={1900} max={2100} value={f.yearFrom} onChange={(e) => setF({ ...f, yearFrom: e.target.value })} /></label>
            <label><span className="label">Year to</span><input type="number" className="input" min={1900} max={2100} value={f.yearTo} onChange={(e) => setF({ ...f, yearTo: e.target.value })} /></label>
            <label><span className="label">Minimum rating</span><input type="number" className="input" min={0} max={10} step={0.5} value={f.minRating} onChange={(e) => setF({ ...f, minRating: e.target.value })} /></label>
          </div>
          <ChipGroup label="Content type" options={(Object.keys(TYPE_LABEL) as ContentType[]).map((t) => [t, TYPE_LABEL[t]])} selected={f.types} onToggle={(v) => toggle('types', v)} />
          <ChipGroup label="Status" options={[['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['cancelled', 'Cancelled']]} selected={f.status} onToggle={(v) => toggle('status', v)} />
          <ChipGroup label="Demographic" options={[['shounen', 'Shounen'], ['shoujo', 'Shoujo'], ['seinen', 'Seinen'], ['josei', 'Josei']]} selected={f.demographic} onToggle={(v) => toggle('demographic', v)} />
          <ChipGroup label="Content rating" options={[['safe', 'Safe'], ['suggestive', 'Suggestive'], ['erotica', 'Mature']]} selected={f.contentRating} onToggle={(v) => toggle('contentRating', v)} hint={!f.contentRating.length ? `Default: ${(prefs.contentRating ?? ['safe', 'suggestive']).join(', ')}` : undefined} />
          <div>
            <span className="label">Genres & tags <span className="font-normal">— click once to include, twice to exclude</span></span>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {genreList.map((g) => {
                const inc = f.genres.includes(g), exc = f.excludeGenres.includes(g);
                return <button key={g} onClick={() => cycleGenre(g)} aria-pressed={inc || exc} className={cls(inc ? 'chip-on' : 'chip', exc && 'border-danger/60 text-danger line-through')}>{g}</button>;
              })}
            </div>
          </div>
          <button className="btn-ghost text-muted" onClick={() => setF({ ...EMPTY, query: f.query })}><X className="h-4 w-4" />Clear filters</button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-muted mb-4"><AlertTriangle className="h-4 w-4 text-warning shrink-0" /><span>Some sources didn't respond: {errors.map((e) => `${e.source} (${e.error})`).join('; ')}</span></div>
      )}
      {res.isLoading ? <GridSkeleton /> : res.error ? <ErrorState error={res.error} retry={res.refetch} /> : !items.length ? (
        <p className="text-center text-muted py-16">No titles match these filters.</p>
      ) : (
        <>
          <TitleGrid>{items.map((t) => <TitleCard key={t.id} title={t} subtitle={`${t.source}${t.year ? ` · ${t.year}` : ''}${t.status ? ` · ${t.status}` : ''}`} />)}</TitleGrid>
          {res.hasNextPage && <div className="flex justify-center mt-8"><button className="btn-outline" onClick={() => res.fetchNextPage()} disabled={res.isFetchingNextPage}>{res.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load more'}</button></div>}
        </>
      )}
    </div>
  );
}

function ChipGroup({ label, options, selected, onToggle, hint }: { label: string; options: [string, string][]; selected: string[]; onToggle: (v: string) => void; hint?: string }) {
  return (
    <div>
      <span className="label">{label}{hint && <span className="font-normal"> — {hint}</span>}</span>
      <div className="flex flex-wrap gap-1.5">{options.map(([v, l]) => <button key={v} aria-pressed={selected.includes(v)} onClick={() => onToggle(v)} className={selected.includes(v) ? 'chip-on' : 'chip'}>{l}</button>)}</div>
    </div>
  );
}
