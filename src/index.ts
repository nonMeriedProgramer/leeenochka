import 'dotenv/config';
import { createBot } from './bot/index.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = createBot(token);

bot.catch((err) => {
  console.error('Bot error:', err);
});

console.log('🦞 Leeenochka bot starting...');
bot.start();
