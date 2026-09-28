import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Users } from '../dist/users.js';
import { createApp } from '../dist/app.js';

test('signed-in users can securely change their own username and password', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcloud-account-settings-test-'));
  const users = new Users(join(root, 'test.sqlite'));
  await users.bootstrap('owner', 'owner-test-password');
  await users.add('member', 'member-old-password');
  await users.add('taken', 'taken-test-password');
  const server = createApp(users).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body, cookie = '', origin) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', cookie, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body)
  });
  const login = async (username, password) => request('/api/login', 'POST', { username, password });
  try {
    const signedIn = await login('member', 'member-old-password');
    const cookie = signedIn.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'member-old-password' })).status, 401);
    assert.equal((await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'wrong-password' }, cookie)).status, 400);
    assert.equal((await request('/api/account', 'PATCH', { username: 'invalid name', currentPassword: 'member-old-password' }, cookie)).status, 400);
    assert.equal((await request('/api/account', 'PATCH', { username: 'taken', currentPassword: 'member-old-password' }, cookie)).status, 400);
    assert.equal((await request('/api/account', 'PATCH', { username: 'member', currentPassword: 'member-old-password', newPassword: 'short' }, cookie)).status, 400);
    assert.equal((await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'member-old-password' }, cookie, 'https://unrelated.example')).status, 403);

    const renamed = await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'member-old-password', role: 'admin' }, cookie);
    assert.equal(renamed.status, 200); assert.deepEqual((await renamed.json()).user, { id: 2, username: 'renamed', role: 'user' });
    assert.equal((await (await fetch(base + '/api/session', { headers: { cookie } })).json()).user.username, 'renamed');
    assert.equal((await login('member', 'member-old-password')).status, 401);
    assert.equal((await login('renamed', 'member-old-password')).status, 200);

    const changed = await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'member-old-password', newPassword: 'member-new-password' }, cookie);
    assert.equal(changed.status, 200); assert.equal((await changed.json()).user.role, 'user');
    assert.equal((await login('renamed', 'member-old-password')).status, 401);
    assert.equal((await login('renamed', 'member-new-password')).status, 200);
    assert.equal((await fetch(base + '/api/session', { headers: { cookie } })).status, 200);
    assert.equal((await request('/api/account', 'PATCH', { username: 'renamed', currentPassword: 'member-new-password', newPassword: '' }, cookie)).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    users.close(); rmSync(root, { recursive: true, force: true });
  }
});
