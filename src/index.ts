import { createBot } from './bot/index.js';
import { startServer } from './auth/oauth-server.js';
import { startScheduler } from './services/scheduler/index.js';
import { initDb } from './db/index.js';
import { createHash } from 'node:crypto';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!process.env.OWNER_TELEGRAM_ID) throw new Error('OWNER_TELEGRAM_ID is required');

const bot = createBot(token);
bot.catch(err => console.error('Bot error:', err.message));

const port = Number(process.env.PORT) || 3001;
const appUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.APP_URL;
// Секрет вебхука: явний з env або стабільний похідний від токена (без нового конфіга)
const webhookSecret = process.env.WEBHOOK_SECRET || createHash('sha256').update(token).digest('hex');

async function main() {
  await bot.init();
  await initDb();
  startScheduler(bot);

  if (appUrl) {
    // Production: webhook mode (Render, Railway, etc.)
    const webhookUrl = `${appUrl}/webhook`;
    await bot.api.setWebhook(webhookUrl, { drop_pending_updates: true, secret_token: webhookSecret });
    console.log(`Webhook: ${webhookUrl}`);
    startServer(bot, port, webhookSecret);

    // Самопінг щоб Render не засипав
    setInterval(() => fetch(appUrl).catch(() => {}), 13 * 60 * 1000);
  } else {
    // Local dev: long polling
    startServer(bot, port);
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('Long polling (local)...');
    await bot.start();
  }

  console.log('🐣 Leeenochka started.');
}

main().catch(err => { console.error(err); process.exit(1); });
