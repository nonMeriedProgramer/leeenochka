// ─── Рендер вечірньої панелі: чорне тло, довільний розмір ──────────────
// Окремо від brief/ui.ts renderPanel: там фіксована ширина 1080 і темно-сіре
// тло під картки брифу, а тут щільна сітка віджетів на чистому чорному.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { C } from './widgets.js';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
let _fonts: Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }> | null = null;
function fonts() {
  return _fonts ??= [
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')), weight: 400, style: 'normal' },
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')), weight: 700, style: 'normal' },
  ];
}

export async function renderBlackPanel(body: string, width: number, height: number): Promise<Buffer> {
  const markup = html(`<div style="display:flex;flex-direction:column;width:${width}px;height:${height}px;background:${C.bg};padding:20px;font-family:'Noto Sans';color:${C.text};">${body}</div>`);
  const svg = await satori(markup as Parameters<typeof satori>[0], { width, height, fonts: fonts() });
  // Віддаємо ×2 — дрібний текст плиток інакше милиться після стиснення в Telegram
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width * 2 } }).render().asPng());
}
