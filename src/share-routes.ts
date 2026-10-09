import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Files, FolderError, ResolvedFolderShare, StoredFile } from './files.js';
import { inspectPreview, previewType } from './previews.js';

const sharePagePath = fileURLToPath(new URL('../public/share.html', import.meta.url));
const sharePage = readFileSync(sharePagePath, 'utf8');
const MAX_UPLOAD = 100 * 1024 * 1024;
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim().length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..';
const publicFile = (file: StoredFile) => ({ id: file.id, name: file.original_name, size: file.size_bytes, createdAt: file.created_at, folderId: file.folder_id, previewKind: previewType(file.original_name).kind });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function shareRoutes(files: Files, directory: string, publicUrl?: string, maxUpload = MAX_UPLOAD) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let activeUploads = 0;
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
  const folderShare = (token: string): ResolvedFolderShare | undefined => files.resolveFolderShare(token);
  const sharedFolderId = (share: ResolvedFolderShare, value: unknown): number => {
    const id = value === undefined || value === null || value === '' ? share.id : Number(value);
    if (!Number.isSafeInteger(id) || id < 1 || !files.folderWithin(share.user_id, share.id, id)) throw new FolderError('Folder not found.', 404);
    return id;
  };
  router.get('/:token', async (req, res, next) => {
    const folder = folderShare(req.params.token);
    if (folder) {
      const shareUrl = `${originFor(req)}/s/${encodeURIComponent(req.params.token)}`;
      const description = `Temporary shared folder · Upload access · Available until ${new Date(folder.expires_at).toISOString()}`;
      const tags = [['og:site_name', 'mCloud'], ['og:type', 'website'], ['og:title', folder.name], ['og:description', description], ['og:url', shareUrl], ['twitter:card', 'summary'], ['twitter:title', folder.name], ['twitter:description', description]];
      const metadata = tags.map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}">`).join('');
      const html = sharePage.replace('<!-- SHARE_META -->', metadata).replace('<title>Shared item · mCloud</title>', `<title>${escapeHtml(folder.name)} · mCloud</title>`).replace('<title>Shared file · mCloud</title>', `<title>${escapeHtml(folder.name)} · mCloud</title>`);
      res.status(200).type('html').send(html); return;
    }
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
      const html = sharePage.replace('<!-- SHARE_META -->', metadata).replace('<title>Shared item · mCloud</title>', `<title>${escapeHtml(title)} · mCloud</title>`);
      res.status(200).type('html').send(html);
    } catch (error) { next(error); }
  });
  router.get('/:token/info', async (req, res, next) => {
    const folder = folderShare(req.params.token);
    if (folder) { res.json({ type: 'folder', name: folder.name, expiresAt: folder.expires_at, maxUploadBytes: maxUpload }); return; }
    const file = files.resolveShare(req.params.token);
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (!files.resolveShare(req.params.token)) { unavailable(res); return; }
      res.json({ type: 'file', name: file.original_name, size: file.size_bytes, expiresAt: file.expires_at, kind: preview.kind, textTooLarge: preview.kind === 'text' && file.size_bytes > 1024 * 1024 });
    } catch (error) { next(error); }
  });
  router.get('/:token/folders', (req, res, next) => {
    const share = folderShare(req.params.token);
    if (!share) { unavailable(res); return; }
    try {
      const contents = files.sharedFolderContents(share, sharedFolderId(share, req.query.folderId));
      res.json({
        folder: { id: contents.folder.id, name: contents.folder.name },
        path: contents.path.map(folder => ({ id: folder.id, name: folder.name })),
        folders: contents.folders,
        files: contents.files.map(publicFile),
        expiresAt: share.expires_at,
        maxUploadBytes: maxUpload
      });
    } catch (error) { next(error); }
  });
  router.post('/:token/folders', (req, res, next) => {
    const share = folderShare(req.params.token);
    if (!share) { unavailable(res); return; }
    try {
      if (!validName(req.body?.name)) throw new FolderError('Enter a valid folder name without slashes or control characters.');
      const parentId = sharedFolderId(share, req.body?.parentId);
      const folder = files.createFolder(share.user_id, req.body.name.trim(), parentId);
      if (!folderShare(req.params.token)) throw new FolderError('This link has expired or was revoked.', 404);
      res.status(201).json({ folder });
    } catch (error) { next(error); }
  });
  router.post('/:token/upload', async (req, res, next) => {
    const share = folderShare(req.params.token);
    if (!share) { unavailable(res); return; }
    let folderId: number;
    try { folderId = sharedFolderId(share, req.headers['x-folder-id']); }
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
    let moved = false; let committed = false; let size = 0; let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxUpload) { req.resume(); res.status(413).json({ error: 'File exceeds the upload size limit.' }); return; }
        await handle.writeFile(chunk);
      }
      await handle.sync(); await handle.close(); handle = undefined;
      const currentShare = folderShare(req.params.token);
      if (!currentShare || !files.folderWithin(currentShare.user_id, currentShare.id, folderId)) { unavailable(res); return; }
      renameSync(temporary, destination); moved = true;
      const file = files.recordUpload(currentShare.user_id, { originalName: name, mimeType: 'application/octet-stream', sizeBytes: size, folderId }, key);
      committed = true;
      res.status(201).json({ file: publicFile(file) });
    } catch (error) { next(error); }
    finally { activeUploads--; await handle?.close().catch(() => {}); if (!committed) await unlink(moved ? destination : temporary).catch(() => {}); }
  });
  router.get('/:token/files/:id/info', async (req, res, next) => {
    const share = folderShare(req.params.token);
    const file = share && files.sharedFile(share, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      res.json({ name: file.original_name, size: file.size_bytes, kind: preview.kind, textTooLarge: preview.kind === 'text' && file.size_bytes > 1024 * 1024 });
    } catch (error) { next(error); }
  });
  router.get('/:token/files/:id/content', async (req, res, next) => {
    const share = folderShare(req.params.token);
    const file = share && files.sharedFile(share, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    try {
      const preview = await inspectPreview(join(directory, file.storage_key), file.original_name);
      if (preview.kind === 'unsupported') { res.status(415).json({ error: 'This format has no browser preview.' }); return; }
      if (preview.kind === 'text' && file.size_bytes > 1024 * 1024) { res.status(413).json({ error: 'Text preview is limited to 1 MB.' }); return; }
      res.set({ 'Content-Type': preview.mime, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'self'" });
      res.sendFile(join(directory, file.storage_key), error => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
  });
  router.get('/:token/files/:id/download', (req, res, next) => {
    const share = folderShare(req.params.token);
    const file = share && files.sharedFile(share, Number(req.params.id));
    if (!file || !existsSync(join(directory, file.storage_key))) { unavailable(res); return; }
    res.set('Content-Type', 'application/octet-stream');
    res.download(join(directory, file.storage_key), file.original_name, error => { if (error && !res.headersSent) next(error); });
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
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof FolderError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  });
  return router;
}
