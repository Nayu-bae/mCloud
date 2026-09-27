import 'dotenv/config';
import { emitKeypressEvents } from 'node:readline';
import { Users } from './users.js';

function secret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal. Passwords are entered privately, not as command arguments.');
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('keypress', listener);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const listener = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text) && value.length + text.length <= 1024) value += text;
    };
    process.stdin.on('keypress', listener);
  });
}

let users: Users | undefined;
try {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (!argument || extra.length || !['add', 'backup'].includes(command)) throw new Error('Usage: npm run user:add -- <username> OR npm run db:backup -- backups/accounts.sqlite');
  users = new Users();
  if (command === 'add') {
    const password = await secret('Password (12+ characters; hidden): ');
    if (password !== await secret('Confirm password: ')) throw new Error('Passwords do not match.');
    await users.add(argument, password);
    console.log('User created. They can now log in.');
  } else {
    users.backup(argument);
    console.log('Database snapshot created. Keep it private and transfer it over SSH, never Git.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operation failed.');
  process.exitCode = 1;
} finally { users?.close(); }
