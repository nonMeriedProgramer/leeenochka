import http from 'http';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import { getDashboardData, renderDashboardHtml } from '../web/dashboard.js';

export function startServer(bot: Bot, port = 3001, secretToken?: string): http.Server {
  const handleUpdate = webhookCallback(bot, 'http', {
    secretToken,                 // №2: відкидає апдейти без правильного X-Telegram-Bot-Api-Secret-Token
    onTimeout: 'return',         // №6: одразу 200 OK → Telegram не ретраїть → нема дублів дій
    timeoutMilliseconds: 55_000,
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      await handleUpdate(req, res);
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/dashboard')) {
      // Особисті тренувальні дані — без токена сторінка не віддається.
      const token = new URL(req.url, 'http://x').searchParams.get('token');
      const expected = process.env.DASHBOARD_SECRET;
      if (!expected || token !== expected) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized. Додай ?token=<DASHBOARD_SECRET>.');
        return;
      }
      try {
        const data = await getDashboardData();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboardHtml(data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Dashboard error: ' + (e instanceof Error ? e.message : 'unknown'));
      }
      return;
    }

    res.writeHead(200); res.end('Leeenochka running');
  });

  server.listen(port, () => console.log(`Server: http://localhost:${port}`));
  return server;
}
