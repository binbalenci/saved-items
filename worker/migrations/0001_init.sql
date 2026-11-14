-- saved-items schema. Source of truth for every writer (Worker, weekly task, page).
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,             -- as shared
  url_norm    TEXT NOT NULL UNIQUE,      -- tracking params stripped; dedup key
  platform    TEXT NOT NULL,             -- facebook|instagram|threads|x|reddit|youtube|web
  title       TEXT,
  text        TEXT,                      -- snippet / caption, filled at capture or by weekly task
  author      TEXT,
  note        TEXT,                      -- Benjamin's own note
  tags        TEXT NOT NULL DEFAULT '[]',-- JSON array of English tags
  starred     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'unknown', -- unknown|ok|dead
  source      TEXT NOT NULL DEFAULT 'bot',     -- bot|chrome|import|manual
  saved_at    TEXT NOT NULL,             -- ISO UTC, when Benjamin saved it
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  enriched_at TEXT                       -- set when the weekly task filled text/tags
);
CREATE INDEX IF NOT EXISTS items_saved_at ON items(saved_at DESC);
CREATE INDEX IF NOT EXISTS items_platform ON items(platform);
CREATE INDEX IF NOT EXISTS items_enriched ON items(enriched_at);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, text, note, tags, author, url,
  content='items', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid,title,text,note,tags,author,url)
  VALUES (new.id,new.title,new.text,new.note,new.tags,new.author,new.url);
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts,rowid,title,text,note,tags,author,url)
  VALUES ('delete',old.id,old.title,old.text,old.note,old.tags,old.author,old.url);
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts,rowid,title,text,note,tags,author,url)
  VALUES ('delete',old.id,old.title,old.text,old.note,old.tags,old.author,old.url);
  INSERT INTO items_fts(rowid,title,text,note,tags,author,url)
  VALUES (new.id,new.title,new.text,new.note,new.tags,new.author,new.url);
END;

CREATE TABLE IF NOT EXISTS digests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_of    TEXT NOT NULL UNIQUE,        -- Friday date, YYYY-MM-DD (Helsinki)
  body_md    TEXT NOT NULL,               -- full digest, shown in the page
  telegram   TEXT NOT NULL,               -- short HTML version the Worker sends
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  sent_at    TEXT
);
