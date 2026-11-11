import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';
import { migrations } from './schema.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
const applied = new Set((db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map((r) => r.version));
migrations.forEach((sql, i) => {
  const v = i + 1;
  if (applied.has(v)) return;
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(v, new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

type P = SQLInputValue | boolean | undefined;
const norm = (params: P[]) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p)) as SQLInputValue[];

const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export const q = {
  get<T = any>(sql: string, ...params: P[]): T | undefined {
    return stmt(sql).get(...norm(params)) as T | undefined;
  },
  all<T = any>(sql: string, ...params: P[]): T[] {
    return stmt(sql).all(...norm(params)) as T[];
  },
  run(sql: string, ...params: P[]) {
    return stmt(sql).run(...norm(params));
  },
};

let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const now = () => new Date().toISOString();
export const json = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
