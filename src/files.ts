import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { openDatabase, databasePath } from './database.js';

export type FileMetadata = { originalName: string; mimeType: string; sizeBytes: number; folderId?: number | null };
export type StoredFile = { id: number; storage_key: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; folder_id: number | null };

export type Folder = { id: number; name: string; parent_id: number | null; created_at: string };
export class FolderError extends Error { constructor(message: string, public status = 400) { super(message); } }

export type ShareLink = { id: number; created_at: number; expires_at: number; revoked_at: number | null };
export type ResolvedFolderShare = Folder & { user_id: number; expires_at: number };
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
      this.db.prepare('INSERT INTO user_files (file_id, user_id, folder_id) VALUES (?, ?, ?)').run(id, userId, metadata.folderId ?? null);
      const file = this.getForUser(userId, id)!;
      this.db.exec('COMMIT');
      return file;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listForUser(userId: number): StoredFile[] {
    return this.db.prepare(`SELECT files.*, user_files.folder_id FROM files JOIN user_files ON files.id = user_files.file_id
      WHERE user_files.user_id = ? ORDER BY files.id DESC`).all(userId) as StoredFile[];
  }

  getForUser(userId: number, fileId: number): StoredFile | undefined {
    return this.db.prepare(`SELECT files.*, user_files.folder_id FROM files JOIN user_files ON files.id = user_files.file_id
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

  folders(userId: number): Folder[] {
    return this.db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as Folder[];
  }

  folder(userId: number, id: number): Folder | undefined {
    return this.db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE user_id = ? AND id = ?').get(userId, id) as Folder | undefined;
  }

  requireFolder(userId: number, id: number | null): void {
    if (id !== null && (!Number.isSafeInteger(id) || !this.folder(userId, id))) throw new FolderError('Folder not found.', 404);
  }

  createFolder(userId: number, name: string, parentId: number | null): Folder {
    this.requireFolder(userId, parentId);
    if (this.db.prepare('SELECT 1 FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE').get(userId, parentId, name)) throw new FolderError('A folder with that name already exists here.', 409);
    const result = this.db.prepare('INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)').run(userId, parentId, name);
    return this.folder(userId, Number(result.lastInsertRowid))!;
  }

  renameFolder(userId: number, id: number, name: string): void {
    const folder = this.folder(userId, id);
    if (!folder) throw new FolderError('Folder not found.', 404);
    if (this.db.prepare('SELECT 1 FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id != ?').get(userId, folder.parent_id, name, id)) throw new FolderError('A folder with that name already exists here.', 409);
    this.db.prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
  }

  deleteFolder(userId: number, id: number): void {
    if (!this.folder(userId, id)) throw new FolderError('Folder not found.', 404);
    if (this.db.prepare('SELECT 1 FROM folders WHERE parent_id = ?').get(id) || this.db.prepare('SELECT 1 FROM user_files WHERE folder_id = ?').get(id)) throw new FolderError('Move or delete the contents before deleting this folder.', 409);
    this.db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, userId);
  }

  move(userId: number, fileId: number, folderId: number | null): void {
    if (!this.getForUser(userId, fileId)) throw new FolderError('File not found.', 404);
    this.requireFolder(userId, folderId);
    this.db.prepare('UPDATE user_files SET folder_id = ? WHERE file_id = ? AND user_id = ?').run(folderId, fileId, userId);
  }

  bulk(userId: number, action: 'move' | 'delete', fileIds: number[], folderIds: number[], destination: number | null = null): StoredFile[] {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const selectedFiles = fileIds.map(id => {
        const file = this.getForUser(userId, id);
        if (!file) throw new FolderError('A selected file was not found. Refresh and try again.', 404);
        return file;
      });
      const selectedFolders = folderIds.map(id => {
        const folder = this.folder(userId, id);
        if (!folder) throw new FolderError('A selected folder was not found. Refresh and try again.', 404);
        return folder;
      });
      const selected = new Set(folderIds);
      const isWithinSelection = (id: number | null): boolean => {
        const seen = new Set<number>();
        while (id !== null) {
          if (selected.has(id)) return true;
          if (seen.has(id)) throw new FolderError('Invalid folder hierarchy.', 409);
          seen.add(id);
          id = this.folder(userId, id)?.parent_id ?? null;
        }
        return false;
      };
      if (action === 'delete') {
        // Check the original state before deleting anything, even selected contents.
        for (const folder of selectedFolders) {
          if (this.db.prepare('SELECT 1 FROM folders WHERE parent_id = ?').get(folder.id) || this.db.prepare('SELECT 1 FROM user_files WHERE folder_id = ?').get(folder.id)) {
            throw new FolderError(`“${folder.name}” is not empty. Nothing was deleted.`, 409);
          }
        }
        for (const file of selectedFiles) this.remove(userId, file.id);
        for (const folder of selectedFolders) this.deleteFolder(userId, folder.id);
      } else {
        this.requireFolder(userId, destination);
        if (isWithinSelection(destination)) throw new FolderError('A folder cannot move into itself or one of its subfolders. Nothing was moved.', 409);
        if (selectedFolders.some(folder => isWithinSelection(folder.parent_id)) || selectedFiles.some(file => isWithinSelection(file.folder_id))) {
          throw new FolderError('Select a folder or its contents, not both. Nothing was moved.', 409);
        }
        for (const folder of selectedFolders) this.db.prepare('UPDATE folders SET parent_id = ? WHERE id = ? AND user_id = ?').run(destination, folder.id, userId);
        for (const file of selectedFiles) this.move(userId, file.id, destination);
      }
      this.db.exec('COMMIT');
      return action === 'delete' ? selectedFiles : [];
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new FolderError('A folder with the same name already exists at the destination. Nothing was moved.', 409);
      throw error;
    }
  }

  createShare(userId: number, fileId: number, durationMinutes: unknown): ShareLink & { token: string } {
    if (!this.getForUser(userId, fileId)) throw new FolderError('File not found.', 404);
    if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) throw new FolderError('Choose a duration between 1 minute and 30 days.');
    const now = Date.now();
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM file_shares WHERE file_id = ? AND revoked_at IS NULL AND expires_at > ?').get(fileId, now);
    if (Number(count?.n) >= 20) throw new FolderError('This file already has 20 active links. Revoke an existing link first.', 409);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + durationMinutes * 60000;
    const result = this.db.prepare('INSERT INTO file_shares (file_id, created_by, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(fileId, userId, hashToken(token), now, expiresAt);
    return { id: Number(result.lastInsertRowid), created_at: now, expires_at: expiresAt, revoked_at: null, token };
  }

  shares(userId: number, fileId: number): ShareLink[] {
    if (!this.getForUser(userId, fileId)) throw new FolderError('File not found.', 404);
    return this.db.prepare('SELECT id, created_at, expires_at, revoked_at FROM file_shares WHERE file_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC').all(fileId, userId, Date.now()) as ShareLink[];
  }

  revokeShare(userId: number, fileId: number, shareId: number): void {
    if (!this.getForUser(userId, fileId)) throw new FolderError('File not found.', 404);
    const result = this.db.prepare('UPDATE file_shares SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND file_id = ? AND created_by = ?').run(Date.now(), shareId, fileId, userId);
    if (Number(result.changes) === 0) throw new FolderError('Share link not found.', 404);
  }

  createFolderShare(userId: number, folderId: number, durationMinutes: unknown): ShareLink & { token: string } {
    if (!this.folder(userId, folderId)) throw new FolderError('Folder not found.', 404);
    if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) throw new FolderError('Choose a duration between 1 minute and 30 days.');
    const now = Date.now();
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM folder_shares WHERE folder_id = ? AND revoked_at IS NULL AND expires_at > ?').get(folderId, now);
    if (Number(count?.n) >= 20) throw new FolderError('This folder already has 20 active links. Revoke an existing link first.', 409);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + durationMinutes * 60000;
    const result = this.db.prepare('INSERT INTO folder_shares (folder_id, created_by, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(folderId, userId, hashToken(token), now, expiresAt);
    return { id: Number(result.lastInsertRowid), created_at: now, expires_at: expiresAt, revoked_at: null, token };
  }

  folderShares(userId: number, folderId: number): ShareLink[] {
    if (!this.folder(userId, folderId)) throw new FolderError('Folder not found.', 404);
    return this.db.prepare('SELECT id, created_at, expires_at, revoked_at FROM folder_shares WHERE folder_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC').all(folderId, userId, Date.now()) as ShareLink[];
  }

  revokeFolderShare(userId: number, folderId: number, shareId: number): void {
    if (!this.folder(userId, folderId)) throw new FolderError('Folder not found.', 404);
    const result = this.db.prepare('UPDATE folder_shares SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND folder_id = ? AND created_by = ?').run(Date.now(), shareId, folderId, userId);
    if (Number(result.changes) === 0) throw new FolderError('Share link not found.', 404);
  }

  resolveFolderShare(token: string): ResolvedFolderShare | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return this.db.prepare(`SELECT folders.id, folders.name, folders.parent_id, folders.created_at, folders.user_id, folder_shares.expires_at
      FROM folder_shares JOIN folders ON folders.id = folder_shares.folder_id
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND folders.user_id = folder_shares.created_by`).get(hashToken(token), Date.now()) as ResolvedFolderShare | undefined;
  }

  folderWithin(userId: number, rootId: number, folderId: number): boolean {
    return Boolean(this.db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM folders WHERE id = ? AND user_id = ?
      UNION ALL SELECT folders.id FROM folders JOIN descendants ON folders.parent_id = descendants.id WHERE folders.user_id = ?
    ) SELECT 1 FROM descendants WHERE id = ?`).get(rootId, userId, userId, folderId));
  }

  foldersWithin(userId: number, rootId: number): Folder[] {
    return this.db.prepare(`WITH RECURSIVE descendants(id, name, parent_id, created_at) AS (
      SELECT id, name, parent_id, created_at FROM folders WHERE id = ? AND user_id = ?
      UNION ALL SELECT folders.id, folders.name, folders.parent_id, folders.created_at FROM folders JOIN descendants ON folders.parent_id = descendants.id WHERE folders.user_id = ?
    ) SELECT id, name, parent_id, created_at FROM descendants ORDER BY name COLLATE NOCASE`).all(rootId, userId, userId) as Folder[];
  }

  sharedFolderContents(share: ResolvedFolderShare, folderId: number): { folder: Folder; folders: Folder[]; files: StoredFile[]; path: Folder[] } {
    if (!this.folderWithin(share.user_id, share.id, folderId)) throw new FolderError('Folder not found.', 404);
    const folder = this.folder(share.user_id, folderId)!;
    const folders = this.db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY name COLLATE NOCASE').all(share.user_id, folderId) as Folder[];
    const files = this.db.prepare(`SELECT files.*, user_files.folder_id FROM files JOIN user_files ON files.id = user_files.file_id
      WHERE user_files.user_id = ? AND user_files.folder_id = ? ORDER BY files.id DESC`).all(share.user_id, folderId) as StoredFile[];
    const path: Folder[] = [];
    let current: Folder | undefined = folder;
    while (current) {
      path.unshift(current);
      if (current.id === share.id) break;
      current = current.parent_id === null ? undefined : this.folder(share.user_id, current.parent_id);
    }
    if (!path.length || path[0].id !== share.id) throw new FolderError('Folder not found.', 404);
    return { folder, folders, files, path };
  }

  sharedFile(share: ResolvedFolderShare, fileId: number): StoredFile | undefined {
    const file = this.getForUser(share.user_id, fileId);
    if (!file || file.folder_id === null) return undefined;
    return this.folderWithin(share.user_id, share.id, file.folder_id) ? file : undefined;
  }

  resolveShare(token: string): (StoredFile & { expires_at: number }) | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return this.db.prepare(`SELECT files.*, user_files.folder_id, file_shares.expires_at FROM file_shares
      JOIN files ON files.id = file_shares.file_id
      JOIN user_files ON user_files.file_id = files.id AND user_files.user_id = file_shares.created_by
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`).get(hashToken(token), Date.now()) as (StoredFile & { expires_at: number }) | undefined;
  }

  storageKeys(): Set<string> {
    return new Set(this.db.prepare('SELECT storage_key FROM files').all().map(row => String(row.storage_key)));
  }

  close(): void { this.db.close(); }
}
