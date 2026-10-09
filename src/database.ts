import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const databasePath = fileURLToPath(new URL('../data/mcloud.sqlite', import.meta.url));

export function openDatabase(path = databasePath): DatabaseSync {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (Number(version) > 6) { db.close(); throw new Error('Database is newer than this app. Update the app before continuing.'); }
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    if (Number(version) < 2) {
      db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));
        UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users);
        CREATE UNIQUE INDEX one_admin ON users(role) WHERE role = 'admin';
        PRAGMA user_version = 2;
        COMMIT;`);
    }
    if (Number(version) < 3) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE files (
          id INTEGER PRIMARY KEY,
          storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key) > 0),
          original_name TEXT NOT NULL CHECK(length(original_name) > 0),
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;
        CREATE TABLE user_files (
          file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
        ) STRICT;
        CREATE INDEX user_files_by_user ON user_files(user_id);
        PRAGMA user_version = 3;
        COMMIT;`);
    }
    if (Number(version) < 4) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE folders (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          parent_id INTEGER,
          name TEXT NOT NULL CHECK(length(trim(name)) > 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(id, user_id),
          FOREIGN KEY(parent_id, user_id) REFERENCES folders(id, user_id) ON DELETE RESTRICT
        ) STRICT;
        CREATE UNIQUE INDEX folder_sibling_names ON folders(user_id, COALESCE(parent_id, 0), name COLLATE NOCASE);
        ALTER TABLE user_files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE RESTRICT;
        CREATE INDEX user_files_by_folder ON user_files(user_id, folder_id);
        CREATE TRIGGER folder_owner_insert BEFORE INSERT ON user_files
          WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.folder_id AND user_id = NEW.user_id)
          BEGIN SELECT RAISE(ABORT, 'Folder must belong to uploader'); END;
        CREATE TRIGGER folder_owner_update BEFORE UPDATE OF folder_id, user_id ON user_files
          WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.folder_id AND user_id = NEW.user_id)
          BEGIN SELECT RAISE(ABORT, 'Folder must belong to uploader'); END;
        PRAGMA user_version = 4;
        COMMIT;`);
    }
    if (Number(version) < 5) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE file_shares (
          id INTEGER PRIMARY KEY,
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          token_hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked_at INTEGER,
          CHECK(expires_at > created_at)
        ) STRICT;
        CREATE INDEX file_shares_by_file ON file_shares(file_id);
        PRAGMA user_version = 5;
        COMMIT;`);
    }
    if (Number(version) < 6) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE folder_shares (
          id INTEGER PRIMARY KEY,
          folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
          created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          token_hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked_at INTEGER,
          CHECK(expires_at > created_at)
        ) STRICT;
        CREATE INDEX folder_shares_by_folder ON folder_shares(folder_id);
        PRAGMA user_version = 6;
        COMMIT;`);
    }
    return db;
}
