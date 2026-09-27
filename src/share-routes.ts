import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Files } from './files.js';
import { inspectPreview } from './previews.js';

export function shareRoutes(files: Files, directory: string) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  const unavailable = (res: express.Response) => res.status(404).json({ error: 'This link has expired, was revoked, or is unavailable.' });
  router.get('/:token', (req, res) => {
    const file = files.resolveShare(req.params.token);
    const valid = file && existsSync(join(directory, file.storage_key));
    res.status(valid ? 200 : 404).sendFile(fileURLToPath(new URL('../public/share.html', import.meta.url)));
  });
  router.get('/:token/info', async (req, res, next) => {
    const file = files.resolveShare(req.params.token);
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (!files.resolveShare(req.params.token)) { unavailable(res); return; }
      res.json({ name: file.original_name, size: file.size_bytes, expiresAt: file.expires_at, kind: preview.kind, textTooLarge: preview.kind === 'text' && file.size_bytes > 1024 * 1024 });
    } catch (error) { next(error); }
  });
  router.get('/:token/content', async (req, res, next) => {
    const file = files.resolveShare(req.params.token);
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (!files.resolveShare(req.params.token)) { unavailable(res); return; }
      if (preview.kind === 'unsupported') { res.status(415).json({ error: 'This format has no browser preview. Use Download to save the file.' }); return; }
      if (preview.kind === 'text' && file.size_bytes > 1024 * 1024) { res.status(413).json({ error: 'Text preview is limited to 1 MB.' }); return; }
      res.set({ 'Content-Type': preview.mime, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'self'" });
      res.sendFile(join(directory, file.storage_key), error => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
  });
  router.get('/:token/download', (req, res, next) => {
    const file = files.resolveShare(req.params.token);
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    res.set('Content-Type', 'application/octet-stream');
    res.download(join(directory, file.storage_key), file.original_name, error => { if (error && !res.headersSent) next(error); });
  });
  return router;
}
