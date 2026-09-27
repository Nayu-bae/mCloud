import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { Files } from './files.js';
import { Users } from './users.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const users = new Users();
await users.bootstrap(process.env.SITE_USERNAME, process.env.SITE_PASSWORD);
const app = createApp(users, process.env.NODE_ENV === 'production', { files: new Files(), directory: fileURLToPath(new URL('../data/uploads/', import.meta.url)) });
app.listen(port, () => console.log(`mClout running at http://localhost:${port}`));
