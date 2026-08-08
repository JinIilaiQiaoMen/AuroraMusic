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
