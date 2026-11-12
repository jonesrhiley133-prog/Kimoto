# Architecture

```
┌──────────────────────── web/ (React + Vite, installable PWA) ────────────────────────┐
│ pages/  Home · Discover · Search · Title · Reader · Library · Lists · Downloads ·     │
│         Stats · Wrapped · Community · Messages · Notifications · Profile · Settings · │
│         Moderation · Onboarding · Auth                                                │
│ lib/    api · theme · prefs · offline (IndexedDB downloads) · session (active-time    │
│         tracker) · progress (offline queue) · discord · socket                        │
└───────────────┬──────────────────────────────────────┬────────────────────────────────┘
        REST /api/*  (cookie session + x-kimoto CSRF header)   Socket.IO (notifications, chat, presence)
┌───────────────┴──────────────────────────────────────┴────────────────────────────────┐
│ server/ (Node 22 + Express + TypeScript)                                                │
│  routes/    auth · titles · library · reading · lists · users · community · messages ·  │
│             settings · stats · integrations                                             │
│  services/  prefs · notify (socket + Web Push + digests) · activity · stats · recommend │
│             moderation · scheduler (new-chapter alerts) · sync/ (MAL, AniList engine)   │
│  sources/   registry + providers: local · mangadex · anilist   ← add more here          │
│  db/        SQLite via node:sqlite, ordered migrations                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
   companion/  local WebSocket → Discord IPC bridge for Rich Presence
```

## Data model (SQLite)

All tables are in `server/src/db/schema.ts`:

- **Users:** `users`, `profiles`, `sessions`, `email_tokens`, `preferences`
- **Content:** `titles`, `chapters`, `source_settings`
- **Reading:** `library_entries`, `reading_progress`, `reading_sessions`, `chapter_reads`, `annotations`, `downloads`
- **Lists:** `lists`, `list_items`, `list_members`, `list_likes`
- **Social:** `follows`, `friendships`, `blocks`, `activity`
- **Community:** `threads`, `comments`, `comment_votes`, `comment_reactions`, `reviews`, `reports`, `mod_log`, `word_filters`
- **Chat:** `conversations`, `conversation_members`, `messages`, `message_reactions`, `custom_emoji`
- **Notifications:** `notifications`, `push_subscriptions`, `chapter_watch`
- **Customization:** `themes`, `layouts`
- **Integrations:** `integrations`, `integration_snapshots`, `sync_conflicts`, `oauth_states`

Title and chapter ids are namespaced by provider (`mangadex:<uuid>`, `local:<folder>`), so one database holds every source.

## Key flows

**Reading and statistics.** The reader starts a `reading_session`. `lib/session.ts` counts *active* seconds: the tab must be visible and you must have interacted within the last 2 minutes. It sends a heartbeat every 30 seconds, and a final beacon when the page closes. The server never credits more time than actually elapsed on the wall clock.

A chapter completion becomes a `chapter_reads` row only if the chapter was open long enough for its length, isn't a repeat within 30 minutes, and passes a per-user rate cap. Every statistic, the Wrapped recap and every ranking is computed from those rows. Nothing is estimated. Users can switch collection off and delete their history.

**Offline.** Downloaded chapters are stored as page blobs in IndexedDB, with a persistent, resumable queue that obeys storage caps. The reader checks for an offline copy first, and falls back to it entirely when the network is down. Progress made offline is queued in `localStorage` and flushed on reconnect. The service worker caches the app shell, so the app opens with no connection.

**Sync (MAL/AniList).** OAuth (MAL uses PKCE). For each entry the engine stores a snapshot of the remote state from the last sync. On every sync:

- only the remote side changed → pull it
- only the local side changed → push it
- both changed and they differ → record a `sync_conflict`, unless the user picked an automatic strategy

The user resolves conflicts in **Settings → Integrations** by keeping either side or merging. Library edits push automatically (debounced) when auto-sync, or sync on chapter completion, is on.

**Notifications.** `notify()` checks the user's category settings and blocks, stores the row, emits it over the socket, and sends Web Push (VAPID) when the user is away. Hourly and daily digests are available. The scheduler polls followed titles for new chapters.

**Security.**
- Passwords are hashed with scrypt.
- Sessions are random tokens. Only their SHA-256 hash is stored, and the cookie is httpOnly and SameSite=Lax.
- Every state-changing request needs a custom header (CSRF).
- Every route checks ownership, and Zod validates all input.
- Rate limits, duplicate-post detection, link limits for new accounts, word filters and auto-hide on repeated reports protect the community.
- Uploads are checked against image magic bytes and served with a restrictive CSP.
- Local files are served with path-traversal protection, and the image proxy only fetches from whitelisted hosts.

## Performance notes

- Pages are lazy-loaded routes, and charts are split into their own chunk.
- Chapter lists use a virtualizer. Images are lazy-loaded and preloaded N pages ahead.
- React Query handles caching and deduplication. Search is debounced.
- Upstream responses go through an in-memory TTL cache. Images are cached on disk. Titles and chapters are cached in SQLite and served stale when a source is down.
- MangaDex requests are serialized to stay under its rate limit.

## Android

`web/android` wraps the web bundle with Capacitor. The app runs from a local origin, so it authenticates with a bearer token, which the server issues when the client sends `x-kimoto-client: app`. The server allows the app's origins for cross-origin requests (`APP_ORIGINS`), and the client rewrites server-relative URLs to the chosen server. Native features live in `web/src/lib/native.ts`, plus a small Java plugin for volume keys. See [ANDROID.md](ANDROID.md).
