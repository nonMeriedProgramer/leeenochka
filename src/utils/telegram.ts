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

  const filePath = path.join(os.tmpdir(), `voice_${fileId}.ogg`);
  const writer = createWriteStream(filePath);
  await pipeline(res.body as never, writer);
  return filePath;
}

const TELEGRAM_MESSAGE_LIMIT = 3900; // з запасом від ліміту Telegram 4096

/** Довгий текст (напр. повна розшифровка) — одним чи кількома повідомленнями поспіль. */
export async function sendLong(api: Api, chatId: number, text: string): Promise<void> {
  for (let i = 0; i < text.length; i += TELEGRAM_MESSAGE_LIMIT) {
    await api.sendMessage(chatId, text.slice(i, i + TELEGRAM_MESSAGE_LIMIT));
  }
}
