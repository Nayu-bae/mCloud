import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Users } from '../dist/users.js';
import { Files } from '../dist/files.js';
import { createApp } from '../dist/app.js';

test('admin deletion removes a user, sessions, folders, shares, metadata and stored uploads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcloud-delete-user-test-'));
  const database = join(root, 'test.sqlite');
  const directory = join(root, 'uploads');
  const users = new Users(database);
  const files = new Files(database);
  await users.bootstrap('owner', 'owner-test-password');
  const member = await users.add('member', 'member-test-password');
  const folder = files.createFolder(member.id, 'Documents', null);
  files.createFolder(member.id, 'Nested', folder.id);
  const server = createApp(users, false, { files, directory }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body, cookie = '') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body)
  });
  const login = async (username, password) => (await request('/api/login', 'POST', { username, password })).headers.get('set-cookie').split(';')[0];
  try {
    const adminCookie = await login('owner', 'owner-test-password');
    const memberCookie = await login('member', 'member-test-password');
    const upload = await fetch(base + '/api/files', {
      method: 'POST', headers: { cookie: memberCookie, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'private.txt', 'X-Folder-Id': String(folder.id) }, body: 'private data'
    });
    assert.equal(upload.status, 201);
    const file = (await upload.json()).file;
    const stored = files.getForUser(member.id, file.id);
    const share = files.createShare(member.id, file.id, 60);
    assert.equal(existsSync(join(directory, stored.storage_key)), true);

    assert.equal((await request(`/api/admin/users/${member.id}`, 'DELETE', {}, memberCookie)).status, 403);
    assert.equal((await request(`/api/admin/users/${users.list()[0].id}`, 'DELETE', {}, adminCookie)).status, 400);
    const removed = await request(`/api/admin/users/${member.id}`, 'DELETE', {}, adminCookie);
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { success: true, cleanupPending: false });
    assert.equal(users.get(member.id), undefined);
    assert.equal(files.getForUser(member.id, file.id), undefined);
    assert.equal(files.folder(member.id, folder.id), undefined);
    assert.equal(files.resolveShare(share.token), undefined);
    assert.equal(existsSync(join(directory, stored.storage_key)), false);
    assert.equal((await fetch(base + '/api/session', { headers: { cookie: memberCookie } })).status, 401);
    assert.equal((await request(`/api/admin/users/${member.id}`, 'DELETE', {}, adminCookie)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    users.close(); files.close(); rmSync(root, { recursive: true, force: true });
  }
});
