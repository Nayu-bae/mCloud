import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Users } from '../dist/users.js';

test('accounts persist, use salted hashes, and bootstrap only once', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-test-'));
  const path = join(folder, 'users.sqlite');
  let users = new Users(path);
  try {
    await assert.rejects(users.bootstrap(), /No users exist/);
    await users.bootstrap('original', 'existing-env-password');
    await users.bootstrap('replacement', 'different-password');
    assert.equal(users.count(), 1);
    assert.equal((await users.authenticate('original', 'existing-env-password')).role, 'admin');
    assert.ok(await users.authenticate('original', 'existing-env-password'));
    assert.equal(await users.authenticate('replacement', 'different-password'), null);
    await users.add('second', 'existing-env-password');
    assert.equal((await users.authenticate('second', 'existing-env-password')).role, 'user');
    const db = new DatabaseSync(path);
    const rows = db.prepare('SELECT password_hash FROM users').all();
    assert.notEqual(rows[0].password_hash, rows[1].password_hash);
    assert.ok(rows.every(row => row.password_hash.startsWith('scrypt-v1$') && !row.password_hash.includes('existing-env-password')));
    db.close();
    users.close();
    users = new Users(path);
    await users.bootstrap();
    assert.equal(users.count(), 2);
    assert.ok(await users.authenticate('second', 'existing-env-password'));
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { users.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('rejects bad credentials, duplicate users, weak new passwords and SQL injection', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-test-'));
  const users = new Users(join(folder, 'users.sqlite'));
  try {
    await users.bootstrap('owner', 'a-long-test-password');
    await assert.rejects(users.add('owner', 'replacement-password'), /already exists/);
    await assert.rejects(users.add('new', 'short'), /12 and 1024/);
    assert.equal(await users.authenticate('owner', 'wrong'), null);
    assert.equal(await users.authenticate("' OR 1=1 --", 'a-long-test-password'), null);
    assert.equal(await users.authenticate({ username: 'owner' }, []), null);
    assert.equal(await users.authenticate('OWNER', 'a-long-test-password'), null);
    assert.ok(await users.authenticate('owner', 'a-long-test-password'));
  } finally { users.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('backup includes committed users while source is open and never overwrites files', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mcloud-test-'));
  const users = new Users(join(folder, 'source.sqlite'));
  try {
    await users.bootstrap('owner', 'a-long-test-password');
    const backup = join(folder, 'backup.sqlite');
    users.backup(backup);
    assert.equal(statSync(backup).mode & 0o777, 0o600);
    assert.throws(() => users.backup(backup), /already exists/);
    assert.throws(() => users.backup(join(folder, 'unsafe.txt')), /sqlite filename/);
    assert.throws(() => users.backup('public/leak.sqlite'), /public website/);
    const restored = new Users(backup);
    try {
      assert.equal(restored.count(), 1);
      assert.ok(await restored.authenticate('owner', 'a-long-test-password'));
    } finally { restored.close(); }
  } finally { users.close(); rmSync(folder, { recursive: true, force: true }); }
});
