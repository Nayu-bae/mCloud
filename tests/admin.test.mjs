import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Users, hashPassword } from '../dist/users.js';
import { createApp } from '../dist/app.js';

test('migration preserves legacy credentials and promotes only the original account', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-migration-test-'));
  const path = join(folder, 'users.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT 'now') STRICT; PRAGMA user_version = 1;`);
  const hash = await hashPassword('original-password');
  legacy.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('owner', hash);
  legacy.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('member', hash);
  legacy.close();
  const users = new Users(path);
  try {
    assert.equal((await users.authenticate('owner', 'original-password')).role, 'admin');
    assert.equal((await users.authenticate('member', 'original-password')).role, 'user');
    const db = new DatabaseSync(path);
    assert.throws(() => db.exec("UPDATE users SET role = 'admin' WHERE username = 'member'"));
    db.close();
  } finally { users.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('admin-only creation, login for new users, no role escalation, and logout protection', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-admin-test-'));
  const users = new Users(join(folder, 'users.sqlite'));
  await users.bootstrap('owner', 'owner-test-password');
  const server = createApp(users).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie = '', origin) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await fetch(base + '/api/admin/users')).status, 401);
    assert.equal((await post('/api/admin/users', { username: 'outsider', password: 'outsider-password' })).status, 401);
    const login = await post('/api/login', { username: 'owner', password: 'owner-test-password' });
    const adminCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await login.json()).user.role, 'admin');
    const session = await fetch(base + '/api/session', { headers: { cookie: adminCookie } });
    assert.equal((await session.json()).user.role, 'admin');
    const created = await post('/api/admin/users', { username: 'member', password: 'member-test-password', role: 'admin' }, adminCookie);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).user.role, 'user');
    assert.equal((await post('/api/admin/users', { username: 'member', password: 'member-test-password' }, adminCookie)).status, 400);
    assert.equal((await post('/api/admin/users', { username: 'weak', password: 'short' }, adminCookie)).status, 400);
    assert.equal((await post('/api/admin/users', { username: {}, password: [] }, adminCookie)).status, 400);
    assert.equal((await post('/api/admin/users', { username: 'cross', password: 'cross-test-password' }, adminCookie, 'https://unrelated.example')).status, 403);
    const memberLogin = await post('/api/login', { username: 'member', password: 'member-test-password' });
    assert.equal(memberLogin.status, 200);
    const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await memberLogin.json()).user.role, 'user');
    assert.equal((await fetch(base + '/api/admin/users', { headers: { cookie: memberCookie } })).status, 403);
    assert.equal((await post('/api/admin/users', { username: 'blocked', password: 'blocked-password' }, memberCookie)).status, 403);
    const list = await fetch(base + '/api/admin/users', { headers: { cookie: adminCookie } });
    const body = await list.json();
    assert.equal(body.users.length, 2);
    assert.ok(body.users.every(user => !('password_hash' in user) && !('password' in user)));
    assert.ok(body.users.every(user => user.storageBytes === 0));
    await post('/api/logout', {}, adminCookie);
    assert.equal((await post('/api/admin/users', { username: 'after-logout', password: 'another-password' }, adminCookie)).status, 401);
    assert.equal(users.count(), 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    users.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('production login throttling limits both proxy source and targeted account', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-throttle-test-'));
  const users = new Users(join(folder, 'users.sqlite'));
  await users.bootstrap('owner', 'owner-test-password');
  await users.add('member', 'member-test-password');
  const server = createApp(users, true).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (username, password, forwardedFor) => fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
    body: JSON.stringify({ username, password })
  });
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await login('owner', 'wrong-password', `203.0.113.${attempt + 1}`)).status, 401);
    }
    assert.equal((await login('owner', 'owner-test-password', '203.0.113.20')).status, 429);
    assert.equal((await login('member', 'member-test-password', '203.0.113.20')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    users.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
