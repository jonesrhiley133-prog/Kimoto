// Ordered migrations. Never edit an applied migration; append a new one.
export const migrations: string[] = [
  /* 1: core schema */ `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user', -- user | moderator | admin
  banned_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_url TEXT, banner_url TEXT, bio TEXT NOT NULL DEFAULT '',
  accent TEXT, region TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT '{}', -- per-section visibility JSON
  favorite_genres TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- sha256 of token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}'
);

-- Content metadata cache (all sources share this; id = "<source>:<sourceId>")
CREATE TABLE titles (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manga', -- manga | manhwa | manhua | webtoon | novel
  title TEXT NOT NULL, alt_titles TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '', cover_url TEXT, banner_url TEXT,
  authors TEXT NOT NULL DEFAULT '[]', artists TEXT NOT NULL DEFAULT '[]',
  genres TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
  demographic TEXT, status TEXT, year INTEGER, content_rating TEXT,
  languages TEXT NOT NULL DEFAULT '[]', original_language TEXT,
  source_rating REAL, source_follows INTEGER,
  links TEXT NOT NULL DEFAULT '{}', -- {al, mal, mu, ...}
  chapter_count INTEGER,
  cached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX titles_title ON titles(title);
CREATE TABLE chapters (
  id TEXT PRIMARY KEY, -- "<source>:<sourceChapterId>"
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  number REAL, number_label TEXT, volume TEXT, name TEXT,
  language TEXT, group_name TEXT, pages INTEGER,
  published_at TEXT, external_url TEXT, downloadable INTEGER NOT NULL DEFAULT 1,
  sort_key REAL NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX chapters_title ON chapters(title_id, sort_key);

CREATE TABLE source_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, source)
);

-- Library & reading
CREATE TABLE library_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id),
  status TEXT NOT NULL DEFAULT 'planning', -- reading|completed|planning|on_hold|dropped|rereading
  progress_chapter REAL NOT NULL DEFAULT 0, progress_volume INTEGER NOT NULL DEFAULT 0,
  rating INTEGER, notes TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]', notify INTEGER NOT NULL DEFAULT 1,
  shelf TEXT,
  last_chapter_id TEXT, last_read_at TEXT, started_at TEXT, completed_at TEXT,
  reread_count INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, title_id)
);
CREATE TABLE reading_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, title_id TEXT NOT NULL,
  page INTEGER NOT NULL DEFAULT 0, total_pages INTEGER NOT NULL DEFAULT 0,
  scroll REAL NOT NULL DEFAULT 0, -- fraction for novels / webtoon
  completed INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, chapter_id)
);
CREATE INDEX progress_title ON reading_progress(user_id, title_id, updated_at);
CREATE TABLE reading_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL, chapter_id TEXT,
  started_at TEXT NOT NULL, last_beat_at TEXT NOT NULL, ended_at TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  pages_read INTEGER NOT NULL DEFAULT 0, chapters_completed INTEGER NOT NULL DEFAULT 0,
  content_type TEXT, genres TEXT NOT NULL DEFAULT '[]', device TEXT,
  flagged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user_time ON reading_sessions(user_id, started_at);
CREATE TABLE chapter_reads ( -- one row per validated chapter completion
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL, chapter_id TEXT NOT NULL, session_id TEXT,
  content_type TEXT, genres TEXT NOT NULL DEFAULT '[]',
  read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX chapter_reads_user ON chapter_reads(user_id, read_at);
CREATE TABLE annotations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL, chapter_id TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'bookmark', -- bookmark | note | panel | quote
  note TEXT NOT NULL DEFAULT '', quote TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX annotations_user ON annotations(user_id, title_id);

-- Lists
CREATE TABLE lists (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'private', -- private | unlisted | public
  share_slug TEXT NOT NULL UNIQUE, collaborative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE list_items (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id), position REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '', added_by TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (list_id, title_id)
);
CREATE TABLE list_members (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (list_id, user_id)
);
CREATE TABLE list_likes (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, user_id)
);

-- Social graph
CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE TABLE friendships ( -- one row per request; accepted rows are friendships
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (requester_id, addressee_id)
);
CREATE TABLE blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'block', -- block | mute
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, target_id, kind)
);

-- Community
CREATE TABLE threads (
  id TEXT PRIMARY KEY, title_id TEXT NOT NULL REFERENCES titles(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general', -- general|characters|arcs|theories|recommendations|reviews
  subject TEXT NOT NULL, body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0, last_activity_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX threads_title ON threads(title_id, last_activity_at);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL, -- chapter | thread | list | profile
  target_id TEXT NOT NULL, title_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT, depth INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX comments_target ON comments(target_type, target_id, created_at);
CREATE TABLE comment_votes (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL, PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE comment_reactions (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL, PRIMARY KEY (comment_id, user_id, emoji)
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, title_id TEXT NOT NULL REFERENCES titles(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL, body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
  helpful INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (title_id, user_id)
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  resolution TEXT, resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, moderator_id TEXT NOT NULL, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, details TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE word_filters (pattern TEXT PRIMARY KEY, action TEXT NOT NULL DEFAULT 'hide');
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- started | completed | rated | reviewed | list_created | list_added | followed
  title_id TEXT, target_id TEXT, data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX activity_user ON activity(user_id, created_at);

-- Messaging
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'dm', name TEXT, icon_url TEXT,
  created_by TEXT NOT NULL, dm_key TEXT UNIQUE,
  last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', last_read_at TEXT, muted INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '', reply_to TEXT, attachment_url TEXT, attachment_kind TEXT,
  edited_at TEXT, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);
CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL, PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE custom_emoji (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL, created_by TEXT
);

-- Notifications
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT,
  actor_id TEXT, image_url TEXT, data TEXT NOT NULL DEFAULT '{}', read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE chapter_watch ( -- last known chapter per title, for release notifications
  title_id TEXT PRIMARY KEY, last_chapter_id TEXT, checked_at TEXT
);

-- Customization
CREATE TABLE themes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE layouts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Integrations
CREATE TABLE integrations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- mal | anilist
  external_id TEXT, external_name TEXT, avatar_url TEXT,
  access_token TEXT, refresh_token TEXT, expires_at TEXT,
  settings TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT, last_error TEXT,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE integration_snapshots ( -- remote state as of last successful sync, per entry
  user_id TEXT NOT NULL, provider TEXT NOT NULL, title_id TEXT NOT NULL,
  remote_id TEXT NOT NULL, data TEXT NOT NULL, synced_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider, title_id)
);
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, title_id TEXT NOT NULL, remote_id TEXT NOT NULL,
  local TEXT NOT NULL, remote TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
  verifier TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Downloads (per-device records; the bytes live in the device's offline storage)
CREATE TABLE downloads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL, chapter_id TEXT NOT NULL, title_id TEXT NOT NULL,
  status TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, device_id, chapter_id)
);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
];
