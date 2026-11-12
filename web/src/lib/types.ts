export type ContentType = 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'novel';
export type Status = 'reading' | 'completed' | 'planning' | 'on_hold' | 'dropped' | 'rereading';

export interface Title {
  id: string; source: string; sourceId: string; type: ContentType; title: string; altTitles: string[]; description: string;
  coverUrl: string | null; bannerUrl: string | null; authors: string[]; artists: string[]; genres: string[]; tags: string[];
  demographic: string | null; status: string | null; year: number | null; contentRating: string | null; languages: string[];
  originalLanguage: string | null; sourceRating: number | null; sourceFollows: number | null; links: Record<string, string>;
  chapterCount: number | null; readable: boolean;
}
export interface Chapter {
  id: string; titleId: string; number: number | null; numberLabel: string | null; volume: string | null; name: string | null;
  language: string | null; group: string | null; pages: number | null; publishedAt: string | null; externalUrl: string | null; downloadable: boolean;
}
export interface Entry {
  titleId: string; status: Status; progressChapter: number; progressVolume: number; rating: number | null; notes: string; favorite: boolean;
  tags: string[]; notify: boolean; shelf: string | null; lastChapterId: string | null; lastReadAt: string | null; startedAt: string | null;
  completedAt: string | null; rereadCount: number; addedAt: string; updatedAt: string;
}
export interface MiniUser { id: string; username: string; displayName: string; avatarUrl: string | null; role?: string }
export interface Presence { online: boolean; lastSeenAt: string | null }
export interface SessionUser extends MiniUser {
  email: string; emailVerified: boolean; bannerUrl: string | null; createdAt: string; role: 'user' | 'moderator' | 'admin'; prefs: any;
}
export type PageData =
  | { kind: 'images'; pages: { url: string; fallbackUrl?: string }[] }
  | { kind: 'text'; html: string }
  | { kind: 'external'; url: string };

export interface Notification {
  id: string; kind: string; title: string; body: string; link: string | null; imageUrl: string | null;
  actor: { username: string; displayName: string; avatarUrl: string | null } | null; data: any; read: boolean; createdAt: string;
}
export interface Comment {
  id: string; parentId: string | null; depth: number; body: string; spoiler: boolean; pinned: boolean; deleted: boolean; hidden: boolean;
  score: number; myVote: number; reactions: { emoji: string; count: number; mine: boolean }[]; editedAt: string | null; createdAt: string;
  user: MiniUser | null; mine: boolean;
}
export interface ListDTO {
  id: string; name: string; description: string; coverUrl: string | null; previews: (string | null)[]; visibility: 'private' | 'unlisted' | 'public';
  slug: string; collaborative: boolean; createdAt: string; updatedAt: string; owner: MiniUser; itemCount: number; likes: number; liked: boolean;
  canEdit: boolean; isOwner: boolean;
  items?: { position: number; note: string; addedAt: string; title: Title }[];
  members?: (MiniUser & { accepted: boolean })[];
}
export interface Message {
  id: string; conversationId: string; userId: string; body: string; deleted: boolean; attachmentUrl: string | null; attachmentKind: string | null;
  editedAt: string | null; createdAt: string; replyTo: { id: string; body: string; author: string } | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
}
export interface Conversation {
  id: string; kind: 'dm' | 'group'; name: string; iconUrl: string | null; createdBy: string; lastMessageAt: string; unread: number; muted: boolean;
  members: (MiniUser & { presence: Presence; lastReadAt: string | null; memberRole: string })[];
  lastMessage: { body: string; userId: string; createdAt: string } | null;
}
export interface Activity {
  id: number; kind: string; createdAt: string; data: any; targetId: string | null; user: MiniUser; title: Title | null;
}
