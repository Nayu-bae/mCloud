import { randomUUID } from 'node:crypto';
import { openDatabase, databasePath } from './database.js';

export type FileMetadata = { originalName: string; mimeType: string; sizeBytes: number };
export type StoredFile = { id: number; storage_key: string; original_name: string; mime_type: string; size_bytes: number; created_at: string };

export class Files {
  private db;
  constructor(path = databasePath) { this.db = openDatabase(path); }

  // Called after staging an upload; this records metadata, not file contents.
  recordUpload(userId: number, metadata: FileMetadata, storageKey = randomUUID()): StoredFile {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Invalid uploader.');
    if (typeof metadata.originalName !== 'string' || !metadata.originalName.trim() || metadata.originalName.length > 255) throw new Error('Invalid filename.');
    if (typeof metadata.mimeType !== 'string' || !metadata.mimeType || metadata.mimeType.length > 255) throw new Error('Invalid MIME type.');
    if (!Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 0) throw new Error('Invalid file size.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT INTO files (storage_key, original_name, mime_type, size_bytes) VALUES (?, ?, ?, ?)')
        .run(storageKey, metadata.originalName, metadata.mimeType, metadata.sizeBytes);
      const id = Number(result.lastInsertRowid);
      this.db.prepare('INSERT INTO user_files (file_id, user_id) VALUES (?, ?)').run(id, userId);
      const file = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as StoredFile;
      this.db.exec('COMMIT');
      return file;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listForUser(userId: number): StoredFile[] {
    return this.db.prepare(`SELECT files.* FROM files JOIN user_files ON files.id = user_files.file_id
      WHERE user_files.user_id = ? ORDER BY files.id DESC`).all(userId) as StoredFile[];
  }

  getForUser(userId: number, fileId: number): StoredFile | undefined {
    return this.db.prepare(`SELECT files.* FROM files JOIN user_files ON files.id = user_files.file_id
      WHERE user_files.user_id = ? AND files.id = ?`).get(userId, fileId) as StoredFile | undefined;
  }

  rename(userId: number, fileId: number, name: string): void {
    this.db.prepare(`UPDATE files SET original_name = ? WHERE id = ? AND id IN
      (SELECT file_id FROM user_files WHERE user_id = ?)`).run(name, fileId, userId);
  }

  remove(userId: number, fileId: number): void {
    this.db.prepare(`DELETE FROM files WHERE id = ? AND id IN
      (SELECT file_id FROM user_files WHERE user_id = ?)`).run(fileId, userId);
  }

  storageKeys(): Set<string> {
    return new Set(this.db.prepare('SELECT storage_key FROM files').all().map(row => String(row.storage_key)));
  }

  close(): void { this.db.close(); }
}
