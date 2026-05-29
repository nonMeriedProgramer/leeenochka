import { Api } from 'grammy';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import os from 'os';

export async function downloadVoice(api: Api, fileId: string): Promise<string> {
  const file = await api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);

  const filePath = path.join(os.tmpdir(), `voice_${fileId}.oga`);
  const writer = createWriteStream(filePath);
  await pipeline(res.body as never, writer);
  return filePath;
}
