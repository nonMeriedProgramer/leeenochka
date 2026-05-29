import { Client } from '@notionhq/client';
import type { ParsedIntent, ProjectMapping } from '../../types/index.js';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// project name (lowercase) → Notion database ID
const PROJECT_MAP: Record<string, string> = {
  default: process.env.NOTION_TASKS_DB_ID ?? '',
  // add more: 'openclaw': 'db_id_here'
};

export function getDatabaseId(project?: string): string {
  if (!project) return PROJECT_MAP.default;
  const key = project.toLowerCase();
  return PROJECT_MAP[key] ?? PROJECT_MAP.default;
}

export async function createTask(intent: ParsedIntent): Promise<string> {
  const dbId = getDatabaseId(intent.project);
  if (!dbId) throw new Error('NOTION_TASKS_DB_ID not configured');

  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: intent.title } }] },
  };

  if (intent.deadline) {
    properties['Due Date'] = { date: { start: intent.deadline } };
  }
  if (intent.priority) {
    properties['Priority'] = { select: { name: intent.priority } };
  }

  const { url } = await notion.pages.create({
    parent: { database_id: dbId },
    properties: properties as never,
    children: intent.description
      ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: intent.description } }] } }]
      : [],
  });

  return url;
}

export async function getRecentTasks(limit = 5): Promise<string[]> {
  const dbId = PROJECT_MAP.default;
  if (!dbId) return [];

  const { results } = await notion.databases.query({
    database_id: dbId,
    page_size: limit,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  });

  return results.map(page => {
    const p = page as { properties: Record<string, { title?: Array<{ plain_text: string }> }> };
    const title = p.properties?.Name?.title?.[0]?.plain_text ?? '(без назви)';
    return title;
  });
}
