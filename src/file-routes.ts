import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Files, StoredFile } from './files.js';
import { Account } from './users.js';

const MAX_UPLOAD = 100 * 1024 * 1024;
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim().length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..';
const publicFile = (file: StoredFile) => ({ id: file.id, name: file.original_name, size: file.size_bytes, createdAt: file.created_at });

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
  router.get('/', (req, res) => res.json({ files: files.listForUser(res.locals.userId).map(publicFile), maxUploadBytes: maxUpload }));
  router.post('/', async (req, res, next) => {
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
      // Synchronous finalization prevents other requests from interleaving these steps.
      renameSync(temporary, destination);
      moved = true;
      const file = files.recordUpload(res.locals.userId, { originalName: name, mimeType: 'application/octet-stream', sizeBytes: size }, key);
      committed = true;
      res.status(201).json({ file: publicFile(file) });
    } catch (error) { next(error); }
    finally {
      activeUploads--;
      await handle?.close().catch(() => {});
      if (!committed) await unlink(moved ? destination : temporary).catch(() => {});
    }
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
  return router;
}
