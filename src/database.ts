import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const databasePath = fileURLToPath(new URL('../data/mclout.sqlite', import.meta.url));

export function openDatabase(path = databasePath): DatabaseSync {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (Number(version) > 3) { db.close(); throw new Error('Database is newer than this app. Update the app before continuing.'); }
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
    return db;
}
