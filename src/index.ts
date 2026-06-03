import { createBot } from './bot/index.js';
import { startOAuthServer } from './auth/oauth-server.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!process.env.OWNER_TELEGRAM_ID) throw new Error('OWNER_TELEGRAM_ID is required');

// OAuth callback server (для підключення Google Calendar)
startOAuthServer(Number(process.env.PORT) || 3001);

const bot = createBot(token);
bot.catch(err => console.error('Bot error:', err.message));

console.log('🐣 Leeenochka starting...');
bot.start();
