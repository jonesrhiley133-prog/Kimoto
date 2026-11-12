/**
 * Recognizing links to official, licensed reading platforms.
 *
 * Catalogs like MangaUpdates list where a series is legally published. Kimoto shows those links
 * as "Read officially" buttons. Reading happens on the publisher's own site or app; Kimoto never
 * fetches or re-hosts their pages.
 */
export const OFFICIAL_PLATFORMS: { host: RegExp; name: string }[] = [
  { host: /(^|\.)mangaplus\.shueisha\.co\.jp$/, name: 'MANGA Plus' },
  { host: /(^|\.)shonenjumpplus\.com$/, name: 'Shonen Jump+' },
  { host: /(^|\.)viz\.com$/, name: 'VIZ' },
  { host: /(^|\.)webtoons\.com$/, name: 'WEBTOON' },
  { host: /(^|\.)comic\.naver\.com$/, name: 'Naver Webtoon' },
  { host: /(^|\.)tapas\.io$/, name: 'Tapas' },
  { host: /(^|\.)tappytoon\.com$/, name: 'Tappytoon' },
  { host: /(^|\.)lezhinus\.com$|(^|\.)lezhin\.com$/, name: 'Lezhin' },
  { host: /(^|\.)pocketcomics\.com$/, name: 'Pocket Comics' },
  { host: /(^|\.)kmanga\.kodansha\.com$/, name: 'K MANGA' },
  { host: /(^|\.)kodansha\.us$/, name: 'Kodansha USA' },
  { host: /(^|\.)yenpress\.com$/, name: 'Yen Press' },
  { host: /(^|\.)sevenseasentertainment\.com$/, name: 'Seven Seas' },
  { host: /(^|\.)j-novel\.club$/, name: 'J-Novel Club' },
  { host: /(^|\.)comikey\.com$/, name: 'Comikey' },
  { host: /(^|\.)azuki\.co$/, name: 'Azuki' },
  { host: /(^|\.)mangamo\.com$/, name: 'Mangamo' },
  { host: /(^|\.)inkr\.com$/, name: 'INKR' },
  { host: /(^|\.)globalcomix\.com$/, name: 'GlobalComix' },
  { host: /(^|\.)comic-walker\.com$|(^|\.)comicwalker\.com$/, name: 'ComicWalker' },
  { host: /(^|\.)bookwalker\.jp$|(^|\.)global\.bookwalker\.jp$/, name: 'BOOK☆WALKER' },
  { host: /(^|\.)piccoma\.com$/, name: 'Piccoma' },
  { host: /(^|\.)kakao\.com$/, name: 'KakaoPage' },
  { host: /(^|\.)bilibilicomics\.com$|(^|\.)manga\.bilibili\.com$/, name: 'Bilibili Comics' },
  { host: /(^|\.)ac\.qq\.com$/, name: 'Tencent Comics' },
  { host: /(^|\.)kuaikanmanhua\.com$/, name: 'Kuaikan' },
  { host: /(^|\.)ganganonline\.com$/, name: 'Gangan Online' },
  { host: /(^|\.)ynjn\.jp$/, name: 'Young Jump+' },
  { host: /(^|\.)s-manga\.net$/, name: 'Shueisha' },
  { host: /(^|\.)zebrack-comic\.shueisha\.co\.jp$/, name: 'Zebrack' },
  { host: /(^|\.)magazine\.jp$|(^|\.)pocket\.shonenmagazine\.com$/, name: 'Magazine Pocket' },
  { host: /(^|\.)comic-days\.com$/, name: 'Comic Days' },
  { host: /(^|\.)sunday-webry\.com$/, name: 'Sunday Webry' },
  { host: /(^|\.)urasunday\.com$/, name: 'Ura Sunday' },
];

export function officialPlatform(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return OFFICIAL_PLATFORMS.find((p) => p.host.test(u.hostname))?.name ?? null;
  } catch {
    return null;
  }
}

/** Prefix used to store official links in a title's `links` map: `official:<label>` → url. */
export const OFFICIAL_PREFIX = 'official:';

/**
 * Pulls official reading links out of Markdown text, e.g.
 * "Read for FREE on Manga Plus ([English](https://mangaplus.shueisha.co.jp/titles/100020))".
 * Returns a links map fragment: { "official:MANGA Plus (English)": "https://…" }.
 */
export function extractOfficialLinks(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const platform = officialPlatform(m[2]);
    if (!platform) continue;
    const key = `${OFFICIAL_PREFIX}${officialLabel(platform, m[1])}`;
    if (!out[key] && Object.keys(out).length < 24) out[key] = m[2].replace(/\\_/g, '_');
  }
  return out;
}

/** "MANGA Plus (English)"; the detail is dropped when it just repeats the platform name. */
export function officialLabel(platform: string, detail?: string | null) {
  const d = (detail ?? '').trim();
  const norm = (s: string) => s.toLowerCase().replace(/plus/g, '+').replace(/[^a-z0-9+]+/g, '');
  if (!d || d.length > 40 || norm(d).includes(norm(platform)) || norm(platform).includes(norm(d))) return platform;
  return `${platform} (${d})`;
}

/** Markdown → plain text for descriptions, dropping link lists that are shown as buttons instead. */
export function cleanDescription(markdown: string): string {
  // Everything from the first "**Official …**" / "**Links**" heading on is a link directory.
  const cut = markdown.search(/^\s*\*\*\s*(Official|Links|Note:?\s*Official)/im);
  const body = cut > 0 ? markdown.slice(0, cut) : markdown;
  return body
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
