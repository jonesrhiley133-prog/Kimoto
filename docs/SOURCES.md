# Content sources

Kimoto never hard-codes a website into the reader. Every catalog is a **source provider** that implements one interface (`server/src/sources/types.ts`). You can add or remove providers without touching the reader, library, sync or statistics code. If one upstream changes or goes down, only that provider is affected, and Kimoto keeps serving cached metadata in the meantime.

## Built-in providers

| Provider | Kind | What it does |
|---|---|---|
| `local` | content | Serves manga, comics and novels you own from a folder on the server. Works offline, and downloads are allowed. |
| `mangadex` | content | Uses the official MangaDex API: search, filters, chapter feeds, at-home image delivery and scanlation-group credits. Externally hosted (official) chapters open on the publisher's site. |
| `anilist` | metadata | Uses AniList's public GraphQL API: trending, seasonal, top-rated and light novel discovery, plus AniList's curated official reading links. |
| `kitsu` | metadata | Uses Kitsu's public JSON:API: manga, manhwa, manhua and light novels. Each title maps to its MyAnimeList, AniList and MangaUpdates IDs, so it syncs with trackers and matches readable copies. |
| `mangaupdates` | metadata | Uses MangaUpdates' public API: series data, ratings, licensing, and where each series is officially published. |

Metadata providers have no chapters. Their title pages show **Where to read**, which lists:

- **Read officially:** licensed releases on publishers' own sites and apps (MANGA Plus, VIZ, WEBTOON, K MANGA and so on), taken from MangaUpdates and from AniList's curated links. These open on the publisher's site; Kimoto never fetches or re-hosts their pages.
- **Matches on your enabled reading sources,** found by title and tracker IDs.

Users enable, disable and reorder providers in **Settings → Sources**.

## Local library format

```
data/library/
  my-series/
    series.json          # optional metadata
    cover.jpg            # optional cover (jpg, png, webp, svg)
    Ch. 001 - Title/     # a chapter = a folder of images, sorted naturally
      01.jpg
      02.jpg
    Vol. 2 Ch. 010/      # volume + chapter numbers are parsed from names
  my-light-novel/
    series.json
    Chapter 1.md         # a novel chapter = .md, .txt or .html file
    Chapter 2.md
```

`series.json` (every field optional):

```json
{
  "title": "My Series",
  "type": "manga",
  "description": "…",
  "altTitles": ["…"],
  "authors": ["…"], "artists": ["…"],
  "genres": ["Fantasy", "Adventure"], "tags": ["…"],
  "status": "ongoing", "year": 2024, "demographic": "seinen",
  "language": "en", "contentRating": "safe",
  "links": { "al": "12345", "mal": "67890" }
}
```

`type` is one of `manga`, `manhwa`, `manhua`, `webtoon` or `novel`. It selects the default reader profile (webtoons open in continuous vertical mode, for example). `links.al` / `links.mal` connect the title to AniList/MyAnimeList, so progress syncs.

Novel text is rendered from a safe Markdown subset: headings, *emphasis*, **bold**, `---` scene breaks and paragraphs. Raw HTML is stripped, except for basic formatting tags.

On first start an empty library is filled with three **original** sample works (a manga, a webtoon and a light novel). Delete the folders to remove them.

## Writing a provider

1. Create `server/src/sources/myprovider.ts` that exports a `SourceProvider`:

   ```ts
   export const myprovider: SourceProvider = {
     id: 'myprovider', name: 'My Provider', description: '…', kind: 'content',
     capabilities: { search: true, chapters: true, download: false, novels: false, discover: ['popular', 'latest'], filters: ['query', 'genres', 'sort'] },
     genres: async () => [...],
     search: async (filters) => ({ items: TitleMeta[], total, hasMore }),
     discover: async (section, { limit, offset }) => ({ ... }),
     getTitle: async (sourceId) => TitleMeta,
     getChapters: async (sourceId, { languages }) => ChapterMeta[],
     getPages: async (sourceChapterId) => ({ kind: 'images', pages: [{ url }] }) /* or { kind: 'text', html } or { kind: 'external', url } */,
     related: async (sourceId) => TitleMeta[],          // optional
     allowsImageHost: (host) => host === 'cdn.example.com',
   };
   ```

2. Register it in `server/src/sources/registry.ts`.

That's it. Search, discovery, title pages, the reader, downloads, history, statistics, recommendations and sync all work through the interface.

### Rules for providers

- Use **official APIs** or content you have the right to serve. Don't scrape against a site's terms, and don't bypass logins, paywalls, region locks or DRM.
- Set `downloadable: false` (or `capabilities.download: false`) unless the source permits offline copies.
- Return `{ kind: 'external', url }` for chapters that must be read on the publisher's site.
- Identify yourself with `config.userAgent`, respect rate limits, and cache responses (`TTLCache`).
- Throw `SourceError` with a human-readable message. The UI shows it, and cached data is served if available.
- Images are proxied through `/api/img` only for hosts that `allowsImageHost` returns true for.
