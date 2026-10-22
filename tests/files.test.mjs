import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Users } from '../dist/users.js';
import { Files } from '../dist/files.js';
import { openDatabase } from '../dist/database.js';

test('file records and uploader links are atomic and constrained', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcloud-files-test-'));
  const path = join(dir, 'test.sqlite');
  const users = new Users(path);
  await users.bootstrap('owner', 'test-owner-password');
  const owner = users.list()[0];
  const member = await users.add('member', 'test-member-password');
  const files = new Files(path);
  const db = openDatabase(path);
  try {
    const metadata = { originalName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 1234 };
    const file = files.recordUpload(owner.id, metadata);
    assert.equal(files.listForUser(owner.id)[0].id, file.id);
    assert.equal(files.listForUser(member.id).length, 0);
    assert.deepEqual(users.listWithStorage().map(user => [user.username, user.storageBytes]), [['owner', 1234], ['member', 0]]);
    assert.throws(() => files.recordUpload(999999, metadata));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_files').get().n, 1);
    assert.throws(() => db.prepare('INSERT INTO user_files VALUES (?, ?)').run(file.id, member.id));
    assert.throws(() => db.prepare('DELETE FROM users WHERE id = ?').run(owner.id));
    assert.throws(() => files.recordUpload(owner.id, { ...metadata, sizeBytes: -1 }));
    const other = files.recordUpload(member.id, metadata);
    assert.notEqual(other.storage_key, file.storage_key);
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    assert.equal(files.listForUser(owner.id).length, 0);
    assert.deepEqual(users.listWithStorage().map(user => [user.username, user.storageBytes]), [['owner', 0], ['member', 1234]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_files').get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); files.close(); users.close(); rmSync(dir, { recursive: true, force: true }); }
});
