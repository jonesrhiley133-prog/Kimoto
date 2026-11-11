import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..', '..');

// Minimal .env loader (no dependency): KEY=value lines in the repo root .env
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR ?? 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  root,
  port: Number(env.PORT ?? 4000),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Origins of the native apps (Capacitor). They authenticate with bearer tokens, not cookies. */
  appOrigins: (env.APP_ORIGINS ?? 'https://localhost,http://localhost,capacitor://localhost').split(',').map((s) => s.trim()).filter(Boolean),
  production: env.NODE_ENV === 'production',
  dataDir,
  dbPath: env.DB_PATH ?? path.join(dataDir, 'kimoto.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  imageCacheDir: path.join(dataDir, 'image-cache'),
  libraryDir: env.LOCAL_LIBRARY_DIR ? path.resolve(root, env.LOCAL_LIBRARY_DIR) : path.join(dataDir, 'library'),
  webDist: path.join(root, 'web', 'dist'),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  smtpUrl: env.SMTP_URL,
  mailFrom: env.MAIL_FROM ?? 'Kimoto <no-reply@kimoto.local>',
  mal: { clientId: env.MAL_CLIENT_ID, clientSecret: env.MAL_CLIENT_SECRET },
  anilist: { clientId: env.ANILIST_CLIENT_ID, clientSecret: env.ANILIST_CLIENT_SECRET },
  vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? 'mailto:admin@kimoto.local' },
  userAgent: env.HTTP_USER_AGENT ?? 'Kimoto/0.1 (self-hosted manga reader)',
};

for (const d of [config.uploadsDir, config.imageCacheDir, config.libraryDir]) fs.mkdirSync(d, { recursive: true });
