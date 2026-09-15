// Живий прогін брифу (мережа, без Telegram і без справжньої БД):
//   GARMIN_TOKEN_FILE=~/.garminconnect/garmin_tokens.json INTERVALS_API_KEY=... DATABASE_URL=postgres://x \
//     node --import=tsx/esm tools/test-brief-live.ts <out-dir>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { gatherBriefData } from '../src/services/brief/data.js';
import { briefCaption, renderBrief } from '../src/services/brief/index.js';

const out = process.argv[2] ?? '.';
const t0 = Date.now();
const data = await gatherBriefData();
console.log(`gather: ${Date.now() - t0} мс`);
const g = data.garmin;
console.log('garmin fatal:', g.fatal?.message ?? '—', '| errors:', g.errors);
console.log('garmin: sleep', !!g.sleep, 'readiness', g.readiness?.score, 'status', g.status?.phrase, 'hrv', g.hrv?.lastNight, 'rhr', g.restingHr, 'bb', g.bodyBatteryWake, 'yesterday', g.yesterday);
console.log('intervals: wellness', data.wellness.length, 'activities', data.activities.length, '| weather:', data.weather?.day.tMax, data.weather?.day.code, '| plan:', data.plan.length);
console.log('sources:', data.sources);
const { panels, errors } = await renderBrief(data);
for (const p of panels) writeFileSync(path.join(out, `live-${p.name}.png`), p.png);
console.log('panels:', panels.map((p) => `${p.name} ${p.png.length}`), '| render errors:', errors);
console.log('\n--- caption ---\n' + briefCaption(data));
process.exit(0);
