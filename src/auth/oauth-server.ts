import http from 'http';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';

export function startServer(bot: Bot, port = 3001, secretToken?: string): http.Server {
  const handleUpdate = webhookCallback(bot, 'http', {
    secretToken,                 // №2: відкидає апдейти без правильного X-Telegram-Bot-Api-Secret-Token
    onTimeout: 'return',         // №6: одразу 200 OK → Telegram не ретраїть → нема дублів дій
    timeoutMilliseconds: 55_000,
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      await handleUpdate(req, res);
    } else {
      res.writeHead(200); res.end('Leeenochka running');
    }
  });

  server.listen(port, () => console.log(`Server: http://localhost:${port}`));
  return server;
}
