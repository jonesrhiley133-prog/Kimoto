# Kimoto

A self-hostable platform for reading, tracking and discussing **manga, manhwa, manhua, webtoons and light novels**. It brings together a customizable reader, a catalog that pulls from multiple sources, MyAnimeList/AniList sync, detailed reading statistics, lists, comments, real-time chat and Discord Rich Presence.

> Kimoto only uses official APIs and content you have the right to serve. It doesn't scrape against site terms or bypass DRM; see [docs/SOURCES.md](docs/SOURCES.md).

## Features

| Area | What you get |
|---|---|
| **Accounts** | Register, sign in, email verification, password reset, sessions list and remote sign-out, data export (JSON), account deletion, avatars and banners, bio, accent color, public/private profile with per-section visibility, follow, friends, block and mute |
| **Discovery** | Trending, popular, recently updated, new releases, seasonal, highest rated, most favorited, light novels, community favorites, random title, personalized recommendations, advanced search (title, alt titles, author/artist, include/exclude genres, demographic, status, year range, language, rating, content rating, source, sort) |
| **Sources** | Modular providers: **Local library**, **MangaDex** (official API), **AniList** (metadata). Enable or disable and reorder them per user; add new ones by implementing one interface |
| **Reader** | Single page, double page, vertical, webtoon and light novel text modes. RTL/LTR, four scaling modes, margins, spacing, transitions, background, brightness overlay, auto-hide/always/hidden toolbar, immersive and fullscreen. Tap zones, swipes, keyboard shortcuts, volume keys (where reported), auto-scroll, auto chapter progression, preloading, data saver. Separate profiles for manga, manhwa, manhua, webtoon and novels |
| **Annotations** | Bookmark pages, notes, favorite panels, quotes saved from selected novel text |
| **Offline** | Download manager with a persistent queue, pause/resume, progress, quality setting, storage cap, auto-cleanup and an offline library; the app opens and reads with no network |
| **Library** | Reading / completed / planning / on hold / dropped / re-reading; chapter and volume progress, ratings, notes, favorites, custom tags, bookshelves view, bulk edits, filters and sorting |
| **Lists** | Unlimited custom lists: description, cover, drag-and-drop order, private/unlisted/public, share links, collaborators, likes, comments |
| **MAL & AniList** | OAuth connect, import, export (plus MAL-XML download), two-way sync of status, progress, volumes and ratings; automatic, manual or on chapter completion; **snapshot-based conflict resolution**, so nothing is overwritten silently |
| **Community** | Per-chapter comments with nested replies, likes/dislikes, emoji reactions, spoiler tags (whole comment or `||inline||`), edit, delete, pin and sort. Separate title-wide discussions by category, reviews, activity feed, public lists |
| **Moderation** | Reports (auto-hide after 3), moderation dashboard, warn/suspend/remove, word filters (hide/block), held-for-review queue, roles, audit log, announcements, spam protection |
| **Chat** | Real-time DMs and groups: online status, typing indicators, read receipts, reactions, replies, edit/delete, image and GIF sharing, custom emoji, search, mute, block/report, privacy controls |
| **Notifications** | New chapters (per-title toggle), friends, follows, messages, replies, reactions, list invites, community, announcements. In-app, browser and Web Push, with instant, hourly or daily delivery |
| **Statistics** | Totals, reading time, sessions, streaks, daily/monthly/yearly charts, calendar heatmap, genre distribution and trends, time of day, weekday patterns, habits (completion rate, most revisited and abandoned). Ranges from 7 days to all time. Built only from measured activity, with full user control |
| **Reading Wrapped** | A Spotify Wrapped-style yearly recap |
| **Rankings** | Chapters, completions, light novels, reading time, active readers, community members, top-rated and popular titles, popular lists. Daily to all-time; global, friends or region; filterable by genre. Uses validated activity only |
| **Discord** | Optional Rich Presence through a desktop companion, with privacy toggles |
| **Themes** | 11 presets (AMOLED, Midnight, Dark, Light, Dracula, Nord, Catppuccin, Tokyo Night, Ocean, Sakura, Lavender) plus a full editor: every color, radius, shadows, transparency/glass blur, gradients, font, font size, density and animations, with live preview, saved themes and import/export |
| **Layout** | Customizable home dashboard (drag, resize, hide widgets, saved layouts), reorderable and hideable navigation, collapsible sidebar, cover sizes, command palette (Ctrl/⌘ K), mobile bottom nav |
| **Onboarding** | A 10-step setup wizard covering content types, genres, reading preferences, trackers, notifications, privacy and theme; every step can be skipped |

## Quick start

Requires **Node.js 22.13+**. It uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
```

```bash
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000> (proxied by Vite)

The first account you register becomes the **admin**. A fresh install includes three original sample works in the local library, so you can try the reader immediately, even offline.

Optional demo data: three accounts (`alice`, `bob`, `chiyo`, password `kimoto-demo`) with friendships, lists, comments and a DM. Add `-- --history` to also generate *simulated* reading history for those demo accounts, so you can preview the statistics screens. Don't run it on a real instance.

```bash
npm run seed
```

### Production

```bash
npm run build
```

```bash
NODE_ENV=production PUBLIC_URL=https://kimoto.example.com npm start
```

The server serves the built web app and the API on one port (`PORT`, default 4000). Put it behind HTTPS, which secure cookies, push notifications and service workers require. Copy `.env.example` to `.env` to configure SMTP, MyAnimeList, AniList and more.

### Tests

```bash
npm test
```

```bash
npm run typecheck
```

The API tests run against a throwaway database. They cover auth, CSRF, sources and path-traversal protection, reading validation and heartbeat capping, library, lists, comments and blocking, messaging privacy, sync conflict handling, and the rankings opt-out.

## Configuration highlights

- **MyAnimeList:** create an app at <https://myanimelist.net/apiconfig> with the redirect URL `PUBLIC_URL/api/integrations/mal/callback`, then set `MAL_CLIENT_ID` (and `MAL_CLIENT_SECRET` if one was issued).
- **AniList:** create a client at <https://anilist.co/settings/developer> with the redirect URL `PUBLIC_URL/api/integrations/anilist/callback`, then set `ANILIST_CLIENT_ID` and `ANILIST_CLIENT_SECRET`.
- **Email:** set `SMTP_URL`. Without it, verification and reset links are printed to the server log.
- **Discord:** see [companion/README.md](companion/README.md).
- **Your own manga and novels:** put folders in `data/library` (format in [docs/SOURCES.md](docs/SOURCES.md)).

## Project layout

```
server/     Node + Express + TypeScript API, SQLite, Socket.IO, source providers, sync engine
web/        React + Vite + Tailwind PWA
companion/  Discord Rich Presence bridge (desktop)
docs/       ARCHITECTURE.md, SOURCES.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model, key flows, security and the path to an Android app.
