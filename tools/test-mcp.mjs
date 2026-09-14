// Локальний smoke-тест MCP-ендпоінта: піднімає http.createServer із handleMcpRequest
// напряму (без grammy/бота/БД) і шле реальні JSON-RPC запити через fetch.
//   INTERVALS_API_KEY=... MCP_SECRET=test123 node tools/test-mcp.mjs
import http from 'node:http';
import { handleMcpRequest } from '../dist/mcp/server.js';

const PORT = 3999;
const secret = process.env.MCP_SECRET;
if (!secret) { console.error('Set MCP_SECRET'); process.exit(1); }

const server = http.createServer(async (req, res) => {
  if (await handleMcpRequest(req, res)) return;
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(PORT, r));

const url = `http://localhost:${PORT}/mcp/${secret}`;
async function rpc(method, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  const body = line ? line.slice(6) : text;
  console.log(`--- ${method} (${res.status}) ---`);
  console.log(body.slice(0, 1500));
}

await rpc('initialize', { protocolVersion: '2026-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '0' } });
await rpc('tools/list');
await rpc('tools/call', { name: 'list_activities', arguments: { oldest: '2026-09-01' } });
if (process.env.TEST_ACTIVITY_ID) {
  await rpc('tools/call', { name: 'get_activity', arguments: { activity_id: process.env.TEST_ACTIVITY_ID } });
}

server.close();
