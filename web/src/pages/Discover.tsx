import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Shuffle, SlidersHorizontal, Star } from 'lucide-react';
import { api, enc } from '@/lib/api';
import { useAuth, useToast } from '@/hooks/app';
import { GENRES, TYPE_LABEL, cls } from '@/lib/format';
import type { Title } from '@/lib/types';
import { ErrorState, Spinner, Tabs } from '@/components/ui';
import { GridSkeleton, TitleCard, TitleGrid, titleHref } from '@/components/titles';
import { layoutFrom } from '@/lib/prefs';

const SECTIONS = [
  { id: 'trending', label: 'Trending' }, { id: 'popular', label: 'Popular' }, { id: 'latest', label: 'Recently updated' },
  { id: 'new', label: 'New releases' }, { id: 'seasonal', label: 'This season' }, { id: 'top_rated', label: 'Highest rated' },
  { id: 'most_followed', label: 'Most favorited' }, { id: 'novels', label: 'Light novels' },
  { id: 'community-favorited', label: 'Community favorites' }, { id: 'community-rated', label: 'Community top rated' }, { id: 'community-reading', label: 'Read this week' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const section = (params.get('section') as SectionId) || 'trending';
  const source = params.get('source') ?? '';
  const nav = useNavigate();
  const toast = useToast();
  const { prefs } = useAuth();
  const cardSize = layoutFrom(prefs).cardSize;

  const hero = useQuery({ queryKey: ['discover', 'trending', 'hero'], queryFn: () => api.get<{ items: Title[] }>('/discover/trending?limit=8'), staleTime: 15 * 60_000 });
  const featured = hero.data?.items.find((t) => t.bannerUrl) ?? hero.data?.items[0];

  const community = section.startsWith('community-');
  const list = useInfiniteQuery({
    queryKey: ['discover', section, source],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (community) {
        const r = await api.get<{ items: Title[] }>(`/community/${section.replace('community-', '')}`);
        return { items: r.items, hasMore: false, source: 'kimoto', available: [] as string[] };
      }
      return api.get<{ items: Title[]; hasMore: boolean; source: string | null; available: string[] }>(`/discover/${section}?limit=24&offset=${pageParam}${source ? `&source=${source}` : ''}`);
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * 24 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const meta = list.data?.pages[0];

  const random = async () => {
    try { nav(titleHref(await api.get<Title>('/random'))); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-8">
      {featured && (
        <Link to={titleHref(featured)} className="relative block rounded-xl overflow-hidden min-h-[220px] sm:min-h-[280px] group">
          <img src={featured.bannerUrl ?? featured.coverUrl ?? ''} alt="" className="absolute inset-0 h-full w-full object-cover scale-105 group-hover:scale-100 transition-transform duration-700" style={{ filter: featured.bannerUrl ? undefined : 'blur(24px) brightness(.6)' }} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-transparent" />
          <div className="relative p-6 sm:p-10 flex gap-6 items-end h-full min-h-[inherit]">
            {featured.coverUrl && <img src={featured.coverUrl} alt="" className="hidden sm:block w-32 rounded shadow-card aspect-[2/3] object-cover" />}
            <div className="text-white max-w-xl">
              <span className="text-xs uppercase tracking-widest text-white/70">Trending now · {TYPE_LABEL[featured.type]}</span>
              <h1 className="font-display text-2xl sm:text-4xl font-bold mt-1 leading-tight">{featured.title}</h1>
              <p className="mt-2 text-sm text-white/80 line-clamp-2 sm:line-clamp-3">{featured.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{featured.genres.slice(0, 4).map((g) => <span key={g} className="text-xs rounded-full bg-white/15 px-2.5 py-1">{g}</span>)}</div>
            </div>
          </div>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/discover/search" className="btn-primary"><SlidersHorizontal className="h-4 w-4" />Advanced search</Link>
        <button className="btn-outline" onClick={random}><Shuffle className="h-4 w-4" />Surprise me</button>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {GENRES.map((g) => <Link key={g} to={`/discover/search?genres=${enc(g)}`} className="chip shrink-0">{g}</Link>)}
        </div>
      </div>

      <section>
        <Tabs tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} value={section} onChange={(v) => setParams({ section: v })} className="mb-4" />
        {meta && !community && meta.available.length > 1 && (
          <div className="flex items-center gap-2 mb-4 text-sm text-muted">Source:
            {meta.available.map((s) => <button key={s} onClick={() => setParams({ section, source: s })} className={cls(meta.source === s ? 'chip-on' : 'chip')}>{s}</button>)}
          </div>
        )}
        {list.isLoading ? <GridSkeleton /> : list.error ? <ErrorState error={list.error} retry={list.refetch} /> : !items.length ? (
          <p className="text-sm text-muted py-10 text-center">{community ? 'Not enough community activity yet — this fills in as people read and rate.' : 'No titles here. Enable more sources in Settings → Sources.'}</p>
        ) : (
          <>
            <TitleGrid size={cardSize}>{items.map((t: any) => <TitleCard key={t.id} title={t} size={cardSize} subtitle={t.communityScore != null ? (
              <span className="inline-flex items-center gap-1">{section === 'community-rated' ? <><Star className="h-3 w-3 fill-warning text-warning" />{Number(t.communityScore).toFixed(1)}</> : `${t.communityScore} ${section === 'community-reading' ? 'readers' : 'favorites'}`}</span>) : undefined} />)}</TitleGrid>
            {list.hasNextPage && <div className="flex justify-center mt-8"><button className="btn-outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load more'}</button></div>}
          </>
        )}
      </section>
    </div>
  );
}
