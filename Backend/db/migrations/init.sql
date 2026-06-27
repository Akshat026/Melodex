CREATE TABLE IF NOT EXISTS translations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id         TEXT    NOT NULL,
  target_language TEXT    NOT NULL,
  translated_title TEXT,
  lyrics          TEXT    NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(song_id, target_language)
);

CREATE TABLE IF NOT EXISTS analytics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id         TEXT    NOT NULL,
  target_language TEXT    NOT NULL,
  from_cache      INTEGER NOT NULL DEFAULT 0,
  timestamp       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id         TEXT    NOT NULL,
  target_language TEXT    NOT NULL,
  vote            TEXT    NOT NULL CHECK(vote IN ('up', 'down')),
  timestamp       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_translations_song
  ON translations(song_id, target_language);

CREATE INDEX IF NOT EXISTS idx_analytics_song
  ON analytics(song_id);

CREATE INDEX IF NOT EXISTS idx_feedback_song
  ON feedback(song_id);