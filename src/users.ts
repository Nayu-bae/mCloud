import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databasePath, openDatabase } from './database.js';
export { databasePath } from './database.js';
const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
const parameters = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, salt, hash] = encoded.split('$');
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}

export type Account = { id: number; username: string; role: 'admin' | 'user' };
type UserRow = Account & { password_hash: string };
export class UserInputError extends Error {}

export class Users {
  private db: DatabaseSync;
  // Unknown users still perform the same password hashing work.
  private dummyHash = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

  constructor(path = databasePath) {
    this.db = openDatabase(path);
  }

  get(id: number): Account | undefined {
    return this.db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as Account | undefined;
  }

  list(): Account[] {
    return this.db.prepare('SELECT id, username, role FROM users ORDER BY id').all() as Account[];
  }

  count(): number { return Number(this.db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count); }

  async bootstrap(username?: string, password?: string): Promise<void> {
    if (this.count() > 0) return;
    if (!username || !password) throw new Error('No users exist. Set SITE_USERNAME and SITE_PASSWORD to create the first admin account.');
    // Preserve existing .env credentials, even if they predate the new password policy.
    if (username.length > 256 || password.length > 1024) throw new Error('Bootstrap credentials exceed the login field limits.');
    const hash = await hashPassword(password);
    this.db.prepare(`INSERT INTO users (username, password_hash, role)
      SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)`).run(username, hash);
  }

  async add(username: unknown, password: unknown): Promise<Account> {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.@-]{1,64}$/.test(username)) throw new UserInputError('Use 1–64 letters, numbers, dots, underscores, @ or hyphens for the username.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new UserInputError('Use a password between 12 and 1024 characters.');
    if (this.count() === 0) throw new UserInputError('Start the website with SITE_USERNAME and SITE_PASSWORD to create the first admin account.');
    const hash = await hashPassword(password);
    const result = this.db.prepare(`INSERT INTO users (username, password_hash, role)
      VALUES (?, ?, 'user')
      ON CONFLICT(username) DO NOTHING`).run(username, hash);
    if (Number(result.changes) === 0) throw new UserInputError('That username already exists.');
    return this.get(Number(result.lastInsertRowid))!;
  }

  async authenticate(username: unknown, password: unknown): Promise<Account | null> {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 256 || password.length > 1024) return null;
    const user = this.db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?').get(username) as UserRow | undefined;
    const valid = await verifyPassword(password, user?.password_hash || this.dummyHash);
    return user && valid ? { id: user.id, username: user.username, role: user.role } : null;
  }

  backup(destination: string): void {
    const target = resolve(destination);
    if (target === publicPath.slice(0, -1) || target.startsWith(publicPath)) throw new Error('Backups must not be stored in the public website folder.');
    if (!target.endsWith('.sqlite')) throw new Error('Use a .sqlite filename so Git ignores the backup.');
    if (existsSync(target)) throw new Error('Backup already exists. Choose a new filename.');
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    // VACUUM INTO creates a consistent snapshot, including committed WAL changes.
    const previousMask = process.umask(0o077);
    try { this.db.prepare('VACUUM INTO ?').run(target); chmodSync(target, 0o600); }
    finally { process.umask(previousMask); }
  }

  close(): void { this.db.close(); }
}
