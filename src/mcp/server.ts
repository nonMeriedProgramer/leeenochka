// ─── MCP-сервер поверх intervals.icu — для claude.ai (веб/телефон) ─────────
// Заводить власника в чат Клода з правом читати свої ж тренування, сон, HRV,
// Fitness/Fatigue/Form: список активностей, повну картку однієї (з підходами
// зали з оригінального FIT — те саме, що йде в канал), і щоденні wellness-ряди
// для графіків. Тільки читання, нічого назад в intervals.icu не пише.
//
// Транспорт — Streamable HTTP, без сесій (stateless: кожен запит незалежний,
// найпростіший режим для одноосібного персонального сервера). Підключається
// поверх наявного http.createServer у auth/oauth-server.ts — окремий хостинг
// не потрібен, той самий безкоштовний Render-інстанс, що вже крутить бота.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { buildTrainingPost, fetchActivities, fetchActivityById, fetchWellness } from '../services/training/intervals.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'lenochka-training', version: '1.0.0' });

  server.registerTool(
    'list_activities',
    {
      description: 'Список тренувань за діапазон дат: тип, дистанція/час, пульс, навантаження. '
        + 'Швидкий огляд без деталей — для деталей зали (підходи/кг) бери activity_id і клич get_activity.',
      inputSchema: {
        oldest: z.string().describe('Найдавніша дата, YYYY-MM-DD'),
        newest: z.string().optional().describe('Найновіша дата, YYYY-MM-DD (типово — сьогодні)'),
      },
    },
    async ({ oldest, newest }) => {
      const acts = await fetchActivities(oldest, newest ?? new Date().toISOString().slice(0, 10));
      const brief = acts.map((a) => ({
        id: a.id, date: a.start_date_local?.slice(0, 10), type: a.type, name: a.name,
        distance_km: a.distance ? +(a.distance / 1000).toFixed(2) : null,
        moving_min: a.moving_time ? Math.round(a.moving_time / 60) : null,
        avg_hr: a.average_heartrate, max_hr: a.max_heartrate,
        training_load: a.icu_training_load, calories: a.calories,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(brief, null, 1) }] };
    },
  );

  server.registerTool(
    'get_activity',
    {
      description: 'Повна картка одного тренування за id зі списку list_activities або за посиланням '
        + 'із каналу "gym table" (напр. https://intervals.icu/activities/i186389670 — просто встав як є). '
        + 'Для зали — включно з підходами й вагою (з оригінального файлу годинника), '
        + 'для бігу/вело/боксу — темп/швидкість, пульсові зони, потужність.',
      inputSchema: { activity_id: z.string().describe('id активності або посилання на intervals.icu, звідки id береться') },
    },
    async ({ activity_id }) => {
      // Приймаємо і голий id (i186389670), і повне посилання — беремо останній
      // "iНОМЕР"-шматок рядка, звідки б він не прийшов.
      const match = activity_id.match(/i\d+/);
      const id = match ? match[0] : activity_id.trim();
      const a = await fetchActivityById(id);
      const post = await buildTrainingPost(a);
      return { content: [{ type: 'text', text: JSON.stringify({ ...a, formatted: post.text, kind: post.kind }, null, 1) }] };
    },
  );

  server.registerTool(
    'get_wellness',
    {
      description: 'Щоденні дані відновлення й навантаження за діапазон дат: '
        + 'Fitness (ctl) / Fatigue (atl) / Form (ctl-atl), сон, HRV, пульс спокою, вага, кроки, VO2max, '
        + 'самооцінки (soreness/fatigue/stress/mood/readiness, де 1-4 і менше = гірше, якщо не сказано інакше). '
        + 'Це сирі дані для графіків і трендів — став запитання, малюй графік сам.',
      inputSchema: {
        oldest: z.string().describe('Найдавніша дата, YYYY-MM-DD'),
        newest: z.string().optional().describe('Найновіша дата, YYYY-MM-DD (типово — сьогодні)'),
      },
    },
    async ({ oldest, newest }) => {
      const rows = await fetchWellness(oldest, newest ?? new Date().toISOString().slice(0, 10));
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 1) }] };
    },
  );

  return server;
}

export function mcpSecretConfigured(): boolean {
  return !!process.env.MCP_SECRET;
}

/** true, якщо запит обробили тут (шлях співпав із секретом); інакше — не наш маршрут. */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false;
  const path = (req.url ?? '').split('?')[0];
  if (path !== `/mcp/${secret}`) return false;

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return true;
  }

  const server = makeServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on('close', () => { transport.close(); server.close(); });
  } catch (e) {
    console.error('MCP request failed:', e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
  return true;
}
