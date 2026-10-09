import express from 'express';
import { inspectPreview, previewType } from './previews.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Files, StoredFile, FolderError } from './files.js';
import { Account } from './users.js';

const MAX_UPLOAD = 100 * 1024 * 1024;
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim().length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..';
const publicFile = (file: StoredFile) => ({ id: file.id, name: file.original_name, size: file.size_bytes, createdAt: file.created_at, folderId: file.folder_id, previewKind: previewType(file.original_name).kind });

export function fileRoutes(files: Files, directory: string, currentUser: (req: express.Request) => Account | undefined, maxUpload = MAX_UPLOAD) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // One app instance owns this directory. Recover temporary/orphaned blobs after crashes.
  const known = files.storageKeys();
  for (const key of readdirSync(directory)) {
    if ((/^[a-f0-9-]{36}$/.test(key) && !known.has(key)) || /^\.upload-[a-f0-9-]{36}$/.test(key)) unlinkSync(join(directory, key));
  }
  const router = express.Router();
  let activeUploads = 0;
  router.use((req, res, next) => {
    const user = currentUser(req);
    if (!user) { res.status(401).json({ error: 'Please sign in.' }); return; }
    res.locals.userId = user.id;
    next();
  });
  router.get('/', (req, res) => res.json({ files: files.listForUser(res.locals.userId).map(publicFile), maxUploadBytes: maxUpload, folders: files.folders(res.locals.userId) }));
  const parseFolder = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if ((typeof value !== 'string' && typeof value !== 'number') || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new FolderError('Invalid folder.');
    return Number(value);
  };
  router.post('/bulk', (req, res) => {
    const { action, fileIds, folderIds, destination } = req.body || {};
    const validIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id > 0);
    if (!['move', 'delete'].includes(action) || !validIds(fileIds) || !validIds(folderIds) || fileIds.length + folderIds.length === 0 || fileIds.length + folderIds.length > 100) {
      res.status(400).json({ error: 'Select between 1 and 100 files or folders.' }); return;
    }
    if (action === 'move' && !Object.hasOwn(req.body, 'destination')) { res.status(400).json({ error: 'Choose a destination.' }); return; }
    const removed = files.bulk(res.locals.userId, action, [...new Set(fileIds)], [...new Set(folderIds)], action === 'move' ? parseFolder(destination) : null);
    let cleanupPending = false;
    for (const file of removed) {
      try { unlinkSync(join(directory, file.storage_key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupPending = true; }
    }
    res.json({ success: true, cleanupPending });
  });
  router.post('/folders', (req, res) => {
    if (!validName(req.body?.name)) { res.status(400).json({ error: 'Enter a valid folder name without slashes or control characters.' }); return; }
    const folder = files.createFolder(res.locals.userId, req.body.name.trim(), parseFolder(req.body.parentId));
    res.status(201).json({ folder });
  });
  router.get('/folders/:id/shares', (req, res) => {
    res.json({ links: files.folderShares(res.locals.userId, Number(req.params.id)) });
  });
  router.post('/folders/:id/shares', (req, res) => {
    const share = files.createFolderShare(res.locals.userId, Number(req.params.id), req.body?.durationMinutes);
    res.status(201).json({ id: share.id, expiresAt: share.expires_at, path: `/s/${share.token}` });
  });
  router.delete('/folders/:id/shares/:shareId', (req, res) => {
    files.revokeFolderShare(res.locals.userId, Number(req.params.id), Number(req.params.shareId));
    res.status(204).end();
  });
  router.patch('/folders/:id', (req, res) => {
    if (!validName(req.body?.name)) { res.status(400).json({ error: 'Enter a valid folder name.' }); return; }
    files.renameFolder(res.locals.userId, Number(req.params.id), req.body.name.trim());
    res.json({ folder: files.folder(res.locals.userId, Number(req.params.id)) });
  });
  router.delete('/folders/:id', (req, res) => {
    files.deleteFolder(res.locals.userId, Number(req.params.id));
    res.status(204).end();
  });
  router.post('/', async (req, res, next) => {
    let folderId: number | null;
    try { folderId = parseFolder(req.headers['x-folder-id']); files.requireFolder(res.locals.userId, folderId); }
    catch (error) { next(error); return; }
    let name: string;
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); }
    catch { res.status(400).json({ error: 'Invalid filename.' }); return; }
    if (!validName(name)) { res.status(400).json({ error: 'Use a filename of 1–255 characters without slashes or control characters.' }); return; }
    if (Number(req.headers['content-length']) > maxUpload) { res.status(413).json({ error: 'File exceeds the upload size limit.' }); return; }
    if (activeUploads >= 4) { res.status(429).json({ error: 'Uploads are busy. Please try again shortly.' }); return; }
    activeUploads++;
    const key = randomUUID();
    const temporary = join(directory, `.upload-${key}`);
    const destination = join(directory, key);
    let moved = false;
    let committed = false;
    let size = 0;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxUpload) {
          req.resume();
          res.status(413).json({ error: 'File exceeds the upload size limit.' });
          return;
        }
        await handle.writeFile(chunk);
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (currentUser(req)?.id !== res.locals.userId) { res.status(401).json({ error: 'Session expired. Please sign in and upload again.' }); return; }
      files.requireFolder(res.locals.userId, folderId);
      // Synchronous finalization prevents other requests from interleaving these steps.
      renameSync(temporary, destination);
      moved = true;
      const file = files.recordUpload(res.locals.userId, { originalName: name, mimeType: 'application/octet-stream', sizeBytes: size, folderId }, key);
      committed = true;
      res.status(201).json({ file: publicFile(file) });
    } catch (error) { next(error); }
    finally {
      activeUploads--;
      await handle?.close().catch(() => {});
      if (!committed) await unlink(moved ? destination : temporary).catch(() => {});
    }
  });
  router.get('/:id/shares', (req, res) => {
    res.json({ links: files.shares(res.locals.userId, Number(req.params.id)) });
  });
  router.post('/:id/shares', (req, res) => {
    const share = files.createShare(res.locals.userId, Number(req.params.id), req.body?.durationMinutes);
    res.status(201).json({ id: share.id, expiresAt: share.expires_at, path: `/s/${share.token}` });
  });
  router.delete('/:id/shares/:shareId', (req, res) => {
    files.revokeShare(res.locals.userId, Number(req.params.id), Number(req.params.shareId));
    res.status(204).end();
  });
  router.get('/:id/preview-info', async (req, res, next) => {
    const file = files.getForUser(res.locals.userId, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { res.status(404).json({ error: 'File not found.' }); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      res.json({ ...preview, textTooLarge: preview.kind === 'text' && file.size_bytes > 1024 * 1024 });
    } catch (error) { next(error); }
  });
  router.get('/:id/preview', async (req, res, next) => {
    const file = files.getForUser(res.locals.userId, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { res.status(404).json({ error: 'File not found.' }); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (preview.kind === 'unsupported') { res.status(415).json({ error: 'This file type cannot be previewed in the browser.' }); return; }
      if (preview.kind === 'text' && file.size_bytes > 1024 * 1024) { res.status(413).json({ error: 'Text preview is limited to 1 MB.' }); return; }
      res.set({
        'Content-Type': preview.mime,
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff'
      });
      res.sendFile(join(directory, file.storage_key), error => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
  });
  router.get('/:id/download', (req, res, next) => {
    const file = files.getForUser(res.locals.userId, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { res.status(404).json({ error: 'File not found.' }); return; }
    res.set('Content-Type', 'application/octet-stream');
    res.download(join(directory, file.storage_key), file.original_name, error => { if (error && !res.headersSent) next(error); });
  });
  router.patch('/:id', (req, res) => {
    const file = files.getForUser(res.locals.userId, Number(req.params.id));
    if (!file) { res.status(404).json({ error: 'File not found.' }); return; }
    if (Object.hasOwn(req.body || {}, 'folderId')) {
      files.move(res.locals.userId, file.id, parseFolder(req.body.folderId));
      res.json({ file: publicFile(files.getForUser(res.locals.userId, file.id)!) }); return;
    }
    if (!validName(req.body?.name)) { res.status(400).json({ error: 'Use a filename of 1–255 characters without slashes or control characters.' }); return; }
    files.rename(res.locals.userId, file.id, req.body.name);
    res.json({ file: publicFile({ ...file, original_name: req.body.name }) });
  });
  router.delete('/:id', (req, res, next) => {
    const file = files.getForUser(res.locals.userId, Number(req.params.id));
    if (!file) { res.status(404).json({ error: 'File not found.' }); return; }
    // Remove access first; any blob left by a crash is cleaned on startup.
    files.remove(res.locals.userId, file.id);
    try { unlinkSync(join(directory, file.storage_key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { next(error); return; } }
    res.status(204).end();
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof FolderError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  });
  return router;
}
