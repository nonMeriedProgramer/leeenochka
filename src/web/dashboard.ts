// ─── Живий дашборд тренувань ──────────────────────────────────────
// На відміну від прототипу-артефакту, тут усе читається з Postgres
// у момент запиту — жодних захардкожених чисел. Порожні секції чесно
// показують порожній стан, а не вигадані дані.

import {
  getMaxes, currentWeek, cycleStart, resolveDay, recentLogs,
  logsForExercise, gymScheduleFor, lastWeekGymDays,
  DAYS as PROGRAM_DAYS, MAIN_EXERCISES, DAY_ORDER, dayUk,
} from '../services/training/index.js';
import { WEEKS, TOTAL_WEEKS, weightFromRV6 } from '../services/training/program.js';

const DAY_SHORT: Record<string, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Нд' };
const GOAL_BENCH_KG = 150; // ціль 2026 року, як зафіксовано в /plan (жим лежачи)

function epley1RM(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30));
}

export async function getDashboardData() {
  const [maxes, week, started, sessions, recent, benchLogsDesc, schedule, lastSchedule] = await Promise.all([
    getMaxes(),
    currentWeek(),
    cycleStart(),
    Promise.all(PROGRAM_DAYS.map((d) => resolveDay(d))),
    recentLogs(10),
    logsForExercise(MAIN_EXERCISES.bench, 20),
    gymScheduleFor(),
    lastWeekGymDays(),
  ]);

  const roadmap = WEEKS.map((w) => ({
    week: w.week, phase: w.phase, pct: w.pct,
    kg: weightFromRV6(maxes.bench, w.pct),
  }));

  // хронологічно, лише валідні точки; топ-сет (перший записаний підхід) як оцінка 1ПМ
  const benchHistory = benchLogsDesc
    .filter((r) => r.weight != null && Array.isArray(r.reps) && r.reps.length > 0)
    .map((r) => ({ date: r.log_date, oneRm: epley1RM(r.weight, r.reps[0]) }))
    .reverse();

  const lastBench = benchHistory.length ? benchHistory[benchHistory.length - 1].oneRm : null;
  const goalPct = lastBench ? Math.min(100, Math.round((lastBench / GOAL_BENCH_KG) * 100)) : 0;

  return {
    started,
    week: started ? week : null,
    phase: started ? WEEKS[Math.min(TOTAL_WEEKS, Math.max(1, week)) - 1].phase : null,
    totalWeeks: TOTAL_WEEKS,
    maxes,
    roadmap,
    benchHistory,
    lastBench,
    goalKg: GOAL_BENCH_KG,
    goalPct,
    sessions: sessions.map((s) => ({
      title: s.day.title, subtitle: s.day.subtitle,
      exercises: s.exercises,
    })),
    recent: recent.map((r) => ({
      date: r.log_date, exercise: r.exercise, weight: r.weight,
      reps: Array.isArray(r.reps) ? r.reps : [], source: r.source,
    })),
    scheduleThisWeek: schedule.map((d) => DAY_SHORT[d]),
    scheduleLastWeek: lastSchedule.map((d) => DAY_SHORT[d]),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export function renderDashboardHtml(data: DashboardData): string {
  // JSON у <script type="application/json"> — безпечно від XSS через дані з БД
  // і від передчасного закриття тега (</script> у нотатці тощо).
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тренувальний дашборд — Лєночка</title>
<style>
:root{
  --plane:#eef1f5; --surface:#ffffff; --surface-2:#f4f6f9; --inset:#eaeef3;
  --ink:#14171c; --ink-2:#565b63; --muted:#8a9099;
  --hair:rgba(20,23,28,.10); --grid:#e4e7ec;
  --accent:#2f6fe0; --ember:#ef6a2e; --ember-ink:#c9531e;
  --s1:#2a78d6; --good:#0a9b31;
  --p-reintro:#cfe0f6; --p-accA:#8ab6ee; --p-accB:#3f86df; --p-deload:#d4dae2;
  --p-peak:#ef6a2e; --p-retest:#7b6cf0;
  --shadow:0 1px 2px rgba(16,20,28,.05), 0 10px 30px rgba(16,20,28,.06);
  --ring:0 0 0 1px var(--hair);
  --mono:ui-monospace,"SF Mono","Cascadia Code","Roboto Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --plane:#0d0f12; --surface:#171a1f; --surface-2:#1d2127; --inset:#22272e;
    --ink:#f2f4f7; --ink-2:#aab1bb; --muted:#868d97; --hair:rgba(255,255,255,.11); --grid:#272c33;
    --accent:#5591f2; --ember:#f2794a; --ember-ink:#f79a75; --s1:#3987e5; --good:#37c258;
    --p-reintro:#24384f; --p-accA:#2f5f98; --p-accB:#3987e5; --p-deload:#2a3038; --p-peak:#f2794a; --p-retest:#9085e9;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 34px rgba(0,0,0,.45); color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --plane:#0d0f12; --surface:#171a1f; --surface-2:#1d2127; --inset:#22272e;
  --ink:#f2f4f7; --ink-2:#aab1bb; --muted:#868d97; --hair:rgba(255,255,255,.11); --grid:#272c33;
  --accent:#5591f2; --ember:#f2794a; --ember-ink:#f79a75; --s1:#3987e5; --good:#37c258;
  --p-reintro:#24384f; --p-accA:#2f5f98; --p-accB:#3987e5; --p-deload:#2a3038; --p-peak:#f2794a; --p-retest:#9085e9;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 34px rgba(0,0,0,.45); color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.page{min-height:100vh;padding:clamp(16px,3vw,40px)}
.shell{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:12px}
.glyph{width:44px;height:44px;border-radius:12px;flex:none;background:linear-gradient(140deg,var(--accent),var(--ember));display:grid;place-items:center;color:#fff;font-size:22px;box-shadow:var(--shadow)}
.brand h1{font-size:clamp(20px,2.4vw,26px);margin:0;letter-spacing:-.02em}
.brand .sub{color:var(--ink-2);font-size:13px;margin-top:2px}
.statuschips{display:flex;gap:8px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:var(--surface);box-shadow:var(--ring);font-size:12.5px;color:var(--ink-2)}
.chip b{color:var(--ink);font-family:var(--mono);font-weight:600}
.dot{width:7px;height:7px;border-radius:50%;background:var(--good)}
.eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:11px;font-weight:700;color:var(--muted)}
.card{background:var(--surface);border-radius:16px;box-shadow:var(--shadow),var(--ring);padding:clamp(16px,2vw,22px)}
.card>.head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.card .head h2{font-size:15px;margin:0;letter-spacing:-.01em}
.card .head .note{font-size:12px;color:var(--muted)}
.empty{color:var(--muted);font-size:13px;padding:10px 0}
.roadmap-scroll{overflow-x:auto;padding-bottom:4px}
.roadmap{display:grid;grid-template-columns:repeat(${TOTAL_WEEKS},1fr);gap:6px;min-width:640px;align-items:end;height:170px}
.rm-col{display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px;position:relative}
.rm-kg{font-family:var(--mono);font-size:11px;color:var(--ink-2);font-weight:600}
.rm-bar{width:100%;max-width:34px;border-radius:6px 6px 3px 3px;background:var(--p-accA);transition:height .6s cubic-bezier(.2,.7,.2,1)}
.rm-col.current .rm-bar{outline:2px solid var(--ember);outline-offset:2px}
.rm-here{position:absolute;top:-22px;left:50%;transform:translateX(-50%);background:var(--ember);color:#fff;font-size:10.5px;font-weight:700;white-space:nowrap;padding:3px 8px;border-radius:999px;box-shadow:var(--shadow)}
.rm-wk{font-family:var(--mono);font-size:11px;color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:16px}
.legend .li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-2)}
.legend .sw{width:12px;height:12px;border-radius:3px;flex:none}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--surface);border-radius:14px;box-shadow:var(--shadow),var(--ring);padding:16px}
.tile .k{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.tile .v{font-family:var(--mono);font-size:28px;font-weight:650;letter-spacing:-.02em;margin-top:8px;line-height:1}
.tile .v small{font-size:13px;color:var(--ink-2);font-weight:500}
.tile .m{font-size:12px;color:var(--ink-2);margin-top:7px}
.tile.accent{background:linear-gradient(155deg,var(--accent),var(--ember));color:#fff}
.tile.accent .k,.tile.accent .m{color:rgba(255,255,255,.85)}
.meter{height:6px;border-radius:999px;background:var(--inset);margin-top:10px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:999px;background:var(--ember)}
.tile.accent .meter{background:rgba(255,255,255,.28)}
.tile.accent .meter i{background:#fff}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media (max-width:820px){.grid2{grid-template-columns:1fr}}
svg.chart{width:100%;height:auto;display:block;overflow:visible}
.days{display:flex;flex-direction:column;gap:10px}
.day{background:var(--surface-2);border-radius:12px;padding:12px 14px;box-shadow:var(--ring)}
.day .dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.day .dh b{font-size:13.5px}
.day .dh span{font-size:11px;color:var(--muted);font-family:var(--mono)}
.ex{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13px;padding:3px 0}
.ex .n{color:var(--ink-2)}
.ex .w{font-family:var(--mono);font-weight:600;color:var(--ink);white-space:nowrap}
.rows{display:flex;flex-direction:column;gap:0}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px}
.row:last-child{border-bottom:none}
.row .l{color:var(--ink-2)}
.row .r{font-family:var(--mono);font-weight:600}
.tag{font-size:10.5px;padding:2px 6px;border-radius:5px;background:var(--inset);color:var(--muted);margin-left:6px}
footer{color:var(--muted);font-size:12px;text-align:center;padding:8px 0 4px}
</style>
</head>
<body>
<div class="page"><div class="shell">
  <header class="top">
    <div class="brand">
      <div class="glyph">🏋️</div>
      <div><h1>Тренувальний дашборд</h1><div class="sub">Лєночка · живі дані з бази</div></div>
    </div>
    <div class="statuschips" id="chips"></div>
  </header>

  <section class="card">
    <div class="head"><div><div class="eyebrow">Роадмапа циклу</div><h2 style="margin-top:6px">Жим лежачи по тижнях (кг, від РВ6)</h2></div><div class="note" id="rmNote"></div></div>
    <div id="rmWrap"></div>
    <div class="legend" id="rmLegend"></div>
  </section>

  <section class="tiles" id="tiles"></section>

  <div class="grid2">
    <section class="card">
      <div class="head"><div><div class="eyebrow">Сила</div><h2 style="margin-top:6px">Жим — оцінка 1ПМ</h2></div></div>
      <div id="benchWrap"></div>
    </section>
    <section class="card">
      <div class="head"><div><div class="eyebrow">Журнал</div><h2 style="margin-top:6px">Останні записи</h2></div></div>
      <div id="recentWrap"></div>
    </section>
  </div>

  <section class="card">
    <div class="head"><div><div class="eyebrow">Цей тиждень</div><h2 style="margin-top:6px">Заплановані сесії (з реальними вагами)</h2></div></div>
    <div class="days" id="days"></div>
  </section>

  <footer>Оновлюється при кожному запиті · Лєночка</footer>
</div></div>

<script id="data" type="application/json">${json}</script>
<script>
(function(){
"use strict";
var D = JSON.parse(document.getElementById('data').textContent);
var SVGNS="http://www.w3.org/2000/svg";
var css=function(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();};
var el=function(n,a){var e=document.createElementNS(SVGNS,n);for(var k in a){e.setAttribute(k,a[k]);}return e;};
var esc=function(s){var d=document.createElement('div');d.textContent=String(s);return d.innerHTML;};
var COLOR={'Реінтро':'--p-reintro','Накопичення A':'--p-accA','Накопичення B':'--p-accB','Відкат':'--p-deload','Пік':'--p-peak','Ретест':'--p-retest'};

// chips
var chips=document.getElementById('chips');
chips.innerHTML =
  (D.started ? '<span class="chip"><span class="dot"></span>Цикл активний</span>' : '<span class="chip">Цикл ще не стартував</span>') +
  (D.started ? '<span class="chip">Тиждень <b>'+D.week+'/'+D.totalWeeks+'</b></span>' : '') +
  (D.started ? '<span class="chip">Фаза <b>'+D.phase+'</b></span>' : '') +
  (D.scheduleThisWeek.length ? '<span class="chip">Зал <b>'+D.scheduleThisWeek.join(', ')+'</b></span>' : '<span class="chip">Дні залу не обрано — /gym</span>');

// roadmap
var rmWrap=document.getElementById('rmWrap');
if (!D.started) {
  rmWrap.innerHTML = '<div class="empty">Цикл ще не стартував — обери дні залу через /gym у боті, і роадмапа піде відліком з того тижня.</div>';
} else {
  document.getElementById('rmNote').textContent = 'висота = інтенсивність · тиждень '+D.week+' позначено';
  var rm=document.createElement('div'); rm.className='roadmap-scroll';
  var grid=document.createElement('div'); grid.className='roadmap'; rm.appendChild(grid);
  var vals=D.roadmap.map(function(w){return w.kg;});
  var min=Math.min.apply(null,vals), max=Math.max.apply(null,vals);
  D.roadmap.forEach(function(w){
    var col=document.createElement('div'); col.className='rm-col'+(w.week===D.week?' current':'');
    var hpct = max>min ? (w.kg-min)/(max-min)*78+22 : 60;
    var here = w.week===D.week ? '<div class="rm-here">ти тут</div>' : '';
    col.innerHTML = here+'<div class="rm-kg">'+w.kg+'</div><div class="rm-bar" style="height:0;background:var('+COLOR[w.phase]+')" data-h="'+hpct+'"></div><div class="rm-wk">'+w.week+'</div>';
    col.title='Тиждень '+w.week+' · '+w.phase+' · '+w.kg+' кг';
    grid.appendChild(col);
  });
  rmWrap.appendChild(rm);
  requestAnimationFrame(function(){ setTimeout(function(){
    grid.querySelectorAll('.rm-bar').forEach(function(b){ b.style.height=b.getAttribute('data-h')+'%'; });
  },50); });
}
var lg=document.getElementById('rmLegend');
Object.keys(COLOR).forEach(function(k){
  var d=document.createElement('span'); d.className='li';
  d.innerHTML='<span class="sw" style="background:var('+COLOR[k]+')"></span>'+k;
  lg.appendChild(d);
});

// tiles
var tiles=[
  {k:'Тиждень циклу', v:D.started ? (D.week+'<small>/'+D.totalWeeks+'</small>') : '—', m:D.started ? D.phase : 'ще не стартував'},
  {k:'РВ6 жим', v:D.maxes.bench+'<small> кг</small>', m:'поточна робоча вага'},
  {k:'Останній жим (оцінка 1ПМ)', v:(D.lastBench!=null?D.lastBench:'—')+'<small> кг</small>', m:D.benchHistory.length?'за логами':'логів ще немає'},
  {k:'Ціль 2026 · жим', v:D.goalKg+'<small> кг</small>', m:D.lastBench!=null?(D.goalPct+'% пройдено'):'почни логувати', meter:D.goalPct, accent:true},
];
var tw=document.getElementById('tiles');
tiles.forEach(function(t){
  var d=document.createElement('div'); d.className='tile'+(t.accent?' accent':'');
  var meter = t.meter!=null ? '<div class="meter"><i style="width:'+t.meter+'%"></i></div>' : '';
  d.innerHTML='<div class="k">'+t.k+'</div><div class="v">'+t.v+'</div><div class="m">'+t.m+'</div>'+meter;
  tw.appendChild(d);
});

// bench chart
var bw=document.getElementById('benchWrap');
if (D.benchHistory.length < 2) {
  bw.innerHTML = '<div class="empty">Потрібно щонайменше 2 записи «Жим лежачи» (через бота: «запиши жим 85 на 8,7»), щоб побудувати графік.</div>';
} else {
  var W=520,H=220,pl=40,pr=14,pt=16,pb=26;
  var x0=pl,x1=W-pr,y0=pt,y1=H-pb;
  var vals=D.benchHistory.map(function(p){return p.oneRm;});
  var dMin=Math.min.apply(null,vals)-5, dMax=Math.max(D.goalKg,Math.max.apply(null,vals))+5;
  var X=function(i){return x0+i*(x1-x0)/(D.benchHistory.length-1);};
  var Y=function(v){return y1-(v-dMin)/(dMax-dMin)*(y1-y0);};
  var svg=el('svg',{class:'chart',viewBox:'0 0 '+W+' '+H});
  var step=Math.max(5,Math.round((dMax-dMin)/4/5)*5);
  for(var g=Math.ceil(dMin/step)*step; g<=dMax; g+=step){
    svg.appendChild(el('line',{x1:x0,y1:Y(g),x2:x1,y2:Y(g),stroke:css('--grid'),'stroke-width':1}));
    var t=el('text',{x:x0-8,y:Y(g)+4,'text-anchor':'end',fill:css('--muted'),'font-size':11,'font-family':'var(--mono)'}); t.textContent=g; svg.appendChild(t);
  }
  if (D.goalKg <= dMax && D.goalKg >= dMin) {
    svg.appendChild(el('line',{x1:x0,y1:Y(D.goalKg),x2:x1,y2:Y(D.goalKg),stroke:css('--ember'),'stroke-width':1.5,'stroke-dasharray':'5 4'}));
  }
  var dLine='';
  D.benchHistory.forEach(function(p,i){ dLine += (i?'L':'M')+X(i)+' '+Y(p.oneRm)+' '; });
  var dArea = dLine+'L'+X(D.benchHistory.length-1)+' '+y1+' L'+X(0)+' '+y1+' Z';
  svg.appendChild(el('path',{d:dArea,fill:css('--s1'),opacity:.1}));
  svg.appendChild(el('path',{d:dLine,fill:'none',stroke:css('--s1'),'stroke-width':2.4,'stroke-linejoin':'round','stroke-linecap':'round'}));
  D.benchHistory.forEach(function(p,i){
    var last = i===D.benchHistory.length-1;
    svg.appendChild(el('circle',{cx:X(i),cy:Y(p.oneRm),r:last?4.5:2.6,fill:css('--surface'),stroke:css('--s1'),'stroke-width':last?3:2}));
  });
  bw.appendChild(svg);
  var cap=document.createElement('div'); cap.className='empty';
  cap.textContent='Пунктир — ціль '+D.goalKg+' кг · '+D.benchHistory.length+' записів';
  bw.appendChild(cap);
}

// recent logs
var rw=document.getElementById('recentWrap');
if (!D.recent.length) {
  rw.innerHTML = '<div class="empty">Ще немає жодного запису. Скажи боту: «запиши жим 85 на 8,7».</div>';
} else {
  var rows=document.createElement('div'); rows.className='rows';
  D.recent.forEach(function(r){
    var row=document.createElement('div'); row.className='row';
    var srcTag = r.source==='garmin' ? '<span class="tag">⌚</span>' : '';
    row.innerHTML = '<span class="l">'+r.date+' · '+esc(r.exercise)+srcTag+'</span><span class="r">'+(r.weight!=null?r.weight+' кг':'—')+' × '+r.reps.join(',')+'</span>';
    rows.appendChild(row);
  });
  rw.appendChild(rows);
}

// today's sessions
var dw=document.getElementById('days');
D.sessions.forEach(function(day){
  var d=document.createElement('div'); d.className='day';
  var rows=day.exercises.map(function(e){
    return '<div class="ex"><span class="n">'+e.name+'</span><span class="w">'+e.weight+'</span></div>';
  }).join('');
  d.innerHTML='<div class="dh"><b>'+day.title+'</b><span>'+day.subtitle+'</span></div>'+rows;
  dw.appendChild(d);
});
})();
</script>
</body>
</html>`;
}
