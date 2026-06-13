import { createApp } from './app.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3001);

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`[jotmind-api] listening on http://${HOST}:${PORT}`);
});
