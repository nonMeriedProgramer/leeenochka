import http from 'http';

// Apple Calendar використовує CalDAV (Basic Auth) — OAuth не потрібен
export function startOAuthServer(port = 3001): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200); res.end('Leeenochka running');
  });
  server.listen(port, () => console.log(`Server: http://localhost:${port}`));
  return server;
}
