import http from 'http';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';

export function startServer(bot: Bot, port = 3001): http.Server {
  const handleUpdate = webhookCallback(bot, 'http');

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
