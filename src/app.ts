import express from 'express';
import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareRoutes } from './share-routes.js';
import { fileRoutes } from './file-routes.js';
import { Files } from './files.js';
import { Users, UserInputError } from './users.js';

export function createApp(users: Users, production = false, storage?: { files: Files; directory: string; maxUpload?: number }) {
const app = express();
const lifetime = 8 * 60 * 60 * 1000;
const sessions = new Map<string, { userId: number; expiresAt: number }>();
const attempts = new Map<string, { count: number; until: number }>();
const token = (req: express.Request) => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('mcloud_session='))?.slice(15);
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict' as const, path: '/' };
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  next();
});
app.use(express.json({ limit: '2kb' }));
app.use('/api', (req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    let foreignOrigin = false;
    try { foreignOrigin = Boolean(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host); }
    catch { foreignOrigin = true; }
    const upload = req.method === 'POST' && req.path === '/files' && req.is('application/octet-stream') && typeof req.headers['x-file-name'] === 'string';
    if ((!upload && !req.is('application/json')) || foreignOrigin || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'Request rejected.' }); return;
    }
  }
  next();
});
const currentUser = (req: express.Request) => {
  const session = sessions.get(token(req) || '');
  return session && session.expiresAt > Date.now() ? users.get(session.userId) : undefined;
};
if (storage) {
  app.use('/api/files', fileRoutes(storage.files, storage.directory, currentUser, storage.maxUpload));
  app.use('/s', shareRoutes(storage.files, storage.directory));
}
app.get('/share.js', (_req, res) => res.sendFile(fileURLToPath(new URL('./share-client.js', import.meta.url))));
app.get('/api/session', (req, res) => {
  const user = currentUser(req);
  res.status(user ? 200 : 401).json({ authenticated: Boolean(user), user });
});
app.post('/api/login', async (req, res, next) => {
  try {
  const key = req.ip || 'unknown';
  let attempt = attempts.get(key);
  if (!attempt || attempt.until < Date.now()) { attempt = { count: 0, until: Date.now() + 15 * 60 * 1000 }; attempts.set(key, attempt); }
  if (attempt.count >= 10) { res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' }); return; }
  attempt.count++;
  const user = await users.authenticate(req.body?.username, req.body?.password);
  if (!user) { res.status(401).json({ error: 'Incorrect username or password.' }); return; }
  attempts.delete(key);
  sessions.delete(token(req) || '');
  const session = randomBytes(32).toString('hex');
  sessions.set(session, { userId: user.id, expiresAt: Date.now() + lifetime });
  res.cookie('mcloud_session', session, { ...cookieOptions, maxAge: lifetime }).json({ authenticated: true, user });
  } catch (error) { next(error); }
});
app.post('/api/logout', (req, res) => {
  sessions.delete(token(req) || '');
  res.clearCookie('mcloud_session', cookieOptions).json({ authenticated: false });
});
app.use('/api/admin', (req, res, next) => {
  const user = currentUser(req);
  if (!user) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (user.role !== 'admin') { res.status(403).json({ error: 'Administrator access required.' }); return; }
  next();
});
app.get('/api/admin/users', (_req, res) => res.json({ users: users.list() }));
app.post('/api/admin/users', async (req, res, next) => {
  try {
    // All web-created accounts are ordinary users, regardless of submitted role fields.
    const user = await users.add(req.body?.username, req.body?.password);
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof UserInputError) { res.status(400).json({ error: error.message }); return; }
    next(error);
  }
});
app.delete('/api/admin/users/:id', (req, res, next) => {
  try {
    const admin = currentUser(req)!;
    const id = Number(req.params.id);
    if (id === admin.id) { res.status(400).json({ error: 'You cannot delete your own administrator account.' }); return; }
    const storageKeys = users.remove(id);
    let cleanupPending = false;
    if (storage) {
      for (const key of storageKeys) {
        try { unlinkSync(join(storage.directory, key)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupPending = true; }
      }
    }
    for (const [key, session] of sessions) if (session.userId === id) sessions.delete(key);
    res.json({ success: true, cleanupPending });
  } catch (error) {
    if (error instanceof UserInputError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
});
setInterval(() => {
  for (const [key, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(key);
  for (const [key, attempt] of attempts) if (attempt.until < Date.now()) attempts.delete(key);
}, 60_000).unref();
app.get('/app.js', (_req, res) => res.sendFile(fileURLToPath(new URL('./client.js', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number })?.status;
  res.status(status && status >= 400 && status < 500 ? status : 500).json({ error: status === 413 ? 'Request is too large.' : 'The request could not be completed. Please try again.' });
});
return app;
}
