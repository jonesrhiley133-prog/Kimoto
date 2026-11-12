import type { ContentType } from './types';

/** Reader settings; one profile per content type. */
export interface ReaderProfile {
  mode: 'paged' | 'double' | 'vertical' | 'webtoon';
  direction: 'ltr' | 'rtl';
  fit: 'width' | 'height' | 'screen' | 'original';
  background: string;
  margins: number; // px around pages
  spacing: number; // px between pages (vertical/webtoon)
  scrollSpeed: number; // px per keypress / auto-scroll speed
  transition: 'none' | 'slide' | 'fade';
  brightness: number; // 0..0.8 darkness overlay
  toolbar: 'auto' | 'always' | 'hidden';
  autoNext: boolean;
  chapterTransition: 'confirm' | 'auto';
  tapZones: boolean;
  preload: number;
  dataSaver: boolean;
  immersive: boolean;
  showProgress: boolean;
}
export interface NovelProfile {
  font: 'Literata' | 'Inter' | 'Georgia' | 'Atkinson' | 'System';
  fontSize: number;
  lineHeight: number;
  width: number; // max characters (ch)
  align: 'left' | 'justify';
  theme: 'dark' | 'sepia' | 'light' | 'black' | 'custom';
  textColor: string;
  background: string;
  paragraphSpacing: number;
  indent: boolean;
  brightness: number;
  autoNext: boolean;
  toolbar: 'auto' | 'always' | 'hidden';
  scrollSpeed: number;
}

const manga: ReaderProfile = {
  mode: 'paged', direction: 'rtl', fit: 'screen', background: '#0b0b0f', margins: 0, spacing: 8, scrollSpeed: 400, transition: 'slide',
  brightness: 0, toolbar: 'auto', autoNext: true, chapterTransition: 'confirm', tapZones: true, preload: 3, dataSaver: false, immersive: false, showProgress: true,
};
export const DEFAULT_READER: Record<Exclude<ContentType, 'novel'>, ReaderProfile> = {
  manga,
  manhwa: { ...manga, mode: 'webtoon', direction: 'ltr', fit: 'width', spacing: 0 },
  manhua: { ...manga, mode: 'webtoon', direction: 'ltr', fit: 'width', spacing: 0 },
  webtoon: { ...manga, mode: 'webtoon', direction: 'ltr', fit: 'width', spacing: 0, chapterTransition: 'auto' },
};
export const DEFAULT_NOVEL: NovelProfile = {
  font: 'Literata', fontSize: 19, lineHeight: 1.75, width: 68, align: 'left', theme: 'dark', textColor: '#e8e6e1', background: '#15151a',
  paragraphSpacing: 1, indent: false, brightness: 0, autoNext: true, toolbar: 'auto', scrollSpeed: 300,
};
export const NOVEL_THEMES: Record<string, { bg: string; fg: string }> = {
  dark: { bg: '#15151a', fg: '#e8e6e1' }, black: { bg: '#000000', fg: '#cfcfcf' }, sepia: { bg: '#f4ecd8', fg: '#5b4636' }, light: { bg: '#ffffff', fg: '#222222' },
};

export const NAV_ITEMS = ['home', 'discover', 'library', 'downloads', 'stats', 'community', 'messages', 'profile'] as const;
export type NavItem = (typeof NAV_ITEMS)[number];

export const WIDGETS = {
  continue: 'Continue reading',
  updates: 'Library updates',
  recommended: 'Recommended for you',
  trending: 'Trending',
  stats: 'Activity overview',
  feed: 'Friends activity',
  lists: 'Your lists',
  history: 'Recently read',
  latest: 'Latest releases',
  novels: 'Popular light novels',
} as const;
export type WidgetId = keyof typeof WIDGETS;
export interface WidgetConf { id: WidgetId; size: 'half' | 'full'; hidden?: boolean }
export interface LayoutData { widgets: WidgetConf[]; navOrder: NavItem[]; navHidden: NavItem[]; sidebar: 'expanded' | 'collapsed'; cardSize: 'sm' | 'md' | 'lg' }

export const DEFAULT_LAYOUT: LayoutData = {
  widgets: [
    { id: 'continue', size: 'full' }, { id: 'updates', size: 'full' }, { id: 'recommended', size: 'full' }, { id: 'stats', size: 'half' },
    { id: 'feed', size: 'half' }, { id: 'trending', size: 'full' }, { id: 'latest', size: 'full' }, { id: 'history', size: 'half' },
    { id: 'lists', size: 'half' }, { id: 'novels', size: 'full', hidden: true },
  ],
  navOrder: [...NAV_ITEMS], navHidden: [], sidebar: 'expanded', cardSize: 'md',
};

export function readerProfile(prefs: any, type: ContentType): ReaderProfile {
  const key = (type === 'novel' ? 'manga' : type) as keyof typeof DEFAULT_READER;
  return { ...DEFAULT_READER[key], ...(prefs?.reader?.profiles?.[key] ?? {}) };
}
export function novelProfile(prefs: any): NovelProfile {
  return { ...DEFAULT_NOVEL, ...(prefs?.reader?.profiles?.novel ?? {}) };
}
export function layoutFrom(prefs: any): LayoutData {
  const l = prefs?.layout ?? {};
  const widgets: WidgetConf[] = l.widgets?.length ? l.widgets : DEFAULT_LAYOUT.widgets;
  // Add widgets introduced after the user saved their layout.
  const missing = DEFAULT_LAYOUT.widgets.filter((w) => !widgets.some((x) => x.id === w.id)).map((w) => ({ ...w, hidden: true }));
  const navOrder = (l.navOrder?.length ? l.navOrder : DEFAULT_LAYOUT.navOrder).filter((n: string) => (NAV_ITEMS as readonly string[]).includes(n));
  for (const n of NAV_ITEMS) if (!navOrder.includes(n)) navOrder.push(n);
  return { ...DEFAULT_LAYOUT, ...l, widgets: [...widgets, ...missing], navOrder };
}
