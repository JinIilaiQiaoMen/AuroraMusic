import Database from 'better-sqlite3'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { dbPath, appDataDir } from '../services/storage'

// schema 直接内联，避免 import.meta.url 在 CJS 打包后为 undefined、
// 以及 schema.sql 未被 electron-vite 复制进 out/ 两个问题
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  duration REAL,
  bitrate INTEGER,
  format TEXT,
  cover_path TEXT,
  favorite INTEGER DEFAULT 0,
  created_at INTEGER,
  modified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_songs_title   ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_artist  ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_fav     ON songs(favorite);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  cover_path TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ps_order ON playlist_songs(playlist_id, order_index);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL,
  played_at INTEGER NOT NULL,
  duration_sec REAL,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db
  const path = dbPath()
  // 确保目录存在
  try { if (!existsSync(appDataDir())) mkdirSync(appDataDir(), { recursive: true }) } catch {}

  // 自愈：若存在上次崩溃留下的脏 WAL/SHM 锁文件，先清掉再开
  const tryCleanStaleLocks = () => {
    for (const ext of ['-wal', '-shm']) {
      try { if (existsSync(path + ext)) unlinkSync(path + ext) } catch {}
    }
  }

  try {
    db = new Database(path)
  } catch (e) {
    // 打开失败：清锁文件后重试一次
    tryCleanStaleLocks()
    db = new Database(path)
  }

  // WAL 是性能优化，非必需；失败不应阻止启动
  try { db.pragma('journal_mode = WAL') } catch {}
  try { db.pragma('foreign_keys = ON') } catch {}

  try {
    db.exec(SCHEMA_SQL)
    seedPlaylists(db)
  } catch (e) {
    // schema 执行失败：可能是库文件损坏，清库重建（用户数据丢失但软件能开）
    console.error('[db] schema exec failed, recreating:', e)
    try { db.close() } catch {}
    tryCleanStaleLocks()
    try { if (existsSync(path)) unlinkSync(path) } catch {}
    db = new Database(path)
    try { db.pragma('foreign_keys = ON') } catch {}
    db.exec(SCHEMA_SQL)
    seedPlaylists(db)
  }
  return db
}

function seedPlaylists(d: Database.Database) {
  const count = d.prepare('SELECT COUNT(*) as n FROM playlists').get() as { n: number }
  if (count.n === 0) {
    const now = Date.now()
    const ins = d.prepare('INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?,?,?,?)')
    ins.run('我的收藏', '自动收藏夹，点击 ♡ 自动加入', now, now)
    ins.run('开黑 BGM 精选', '开黑时用的高燃音乐', now, now)
  }
}
export function getDB(): Database.Database { if (!db) throw new Error('DB not init'); return db }
