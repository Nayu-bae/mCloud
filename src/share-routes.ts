import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Files } from './files.js';
import { inspectPreview } from './previews.js';

const sharePagePath = fileURLToPath(new URL('../public/share.html', import.meta.url));
const sharePage = readFileSync(sharePagePath, 'utf8');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function shareRoutes(files: Files, directory: string, publicUrl?: string) {
  let configuredOrigin: string | undefined;
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_URL must use http or https.');
    configuredOrigin = url.origin;
  }
  const router = express.Router();
  router.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  const unavailable = (res: express.Response) => res.status(404).json({ error: 'This link has expired, was revoked, or is unavailable.' });
  const originFor = (req: express.Request) => {
    if (configuredOrigin) return configuredOrigin;
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = ['http', 'https'].includes(forwarded) ? forwarded : req.protocol;
    const host = req.get('host');
    try { return new URL(`${protocol}://${host}`).origin; }
    catch { return `${req.protocol}://localhost`; }
  };
  router.get('/:token', async (req, res, next) => {
    const file = files.resolveShare(req.params.token);
    const valid = file && existsSync(join(directory, file.storage_key));
    if (!valid) { res.status(404).sendFile(sharePagePath); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (!files.resolveShare(req.params.token)) { res.status(404).sendFile(sharePagePath); return; }
      const shareUrl = `${originFor(req)}/s/${encodeURIComponent(req.params.token)}`;
      const contentUrl = `${shareUrl}/content`;
      const title = file.original_name;
      const description = `Temporary shared file · ${sizeLabel(file.size_bytes)} · Available until ${new Date(file.expires_at).toISOString()}`;
      const tags = [
        ['og:site_name', 'mCloud'], ['og:type', 'website'], ['og:title', title], ['og:description', description], ['og:url', shareUrl],
        ['twitter:card', preview.kind === 'image' ? 'summary_large_image' : 'summary'], ['twitter:title', title], ['twitter:description', description]
      ];
      if (preview.kind === 'image') tags.push(['og:image', contentUrl], ['og:image:type', preview.mime], ['twitter:image', contentUrl]);
      if (preview.kind === 'video') tags.push(['og:video', contentUrl], ['og:video:type', preview.mime]);
      if (preview.kind === 'audio') tags.push(['og:audio', contentUrl], ['og:audio:type', preview.mime]);
      const metadata = tags.map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}">`).join('');
      const html = sharePage.replace('<!-- SHARE_META -->', metadata).replace('<title>Shared file · mCloud</title>', `<title>${escapeHtml(title)} · mCloud</title>`);
      res.status(200).type('html').send(html);
    } catch (error) { next(error); }
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
