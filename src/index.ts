import { createBot } from './bot/index.js';
import { startOAuthServer } from './auth/oauth-server.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!process.env.OWNER_TELEGRAM_ID) throw new Error('OWNER_TELEGRAM_ID is required');

// OAuth callback server (для підключення Google Calendar)
startOAuthServer(Number(process.env.PORT) || 3001);

const bot = createBot(token);
bot.catch(err => console.error('Bot error:', err.message));

// Самопінг щоб Render не засипав
const renderUrl = process.env.RENDER_EXTERNAL_URL;
if (renderUrl) {
  setInterval(() => fetch(renderUrl).catch(() => {}), 13 * 60 * 1000);
  console.log(`Self-ping: ${renderUrl} every 13 min`);
}

console.log('🐣 Leeenochka starting...');
bot.start();
