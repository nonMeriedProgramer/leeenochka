// ─── Погода на день — Open-Meteo ──────────────────────────────────────
// Безкоштовно, без ключа й реєстрації. Київ за замовчуванням; інше місто —
// WEATHER_LAT / WEATHER_LON / WEATHER_CITY. Коди погоди — стандарт WMO.

import type { WeatherIcon } from './svg.js';

export interface Weather {
  city: string;
  now: { temp: number; feels: number; code: number; wind: number; isDay: boolean };
  day: {
    code: number; tMax: number; tMin: number;
    precipProb: number | null; uv: number | null; windMax: number | null;
    sunrise: string | null; sunset: string | null;   // "06:33"
  };
  hourly: Array<{ hour: string; temp: number; code: number; precip: number | null; isDay: boolean }>;
  tomorrow: { code: number; tMax: number; tMin: number } | null;
}

const HOURS = ['06', '09', '12', '15', '18', '21'];

export async function fetchWeather(): Promise<Weather | null> {
  const lat = process.env.WEATHER_LAT ?? '50.45';
  const lon = process.env.WEATHER_LON ?? '30.52';
  const city = process.env.WEATHER_CITY ?? 'Київ';
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}&timezone=Europe%2FKyiv&forecast_days=2&wind_speed_unit=ms`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'
    + '&hourly=temperature_2m,weather_code,precipitation_probability'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    return parseWeather(await res.json() as Record<string, any>, city);
  } catch (e) {
    console.error('fetchWeather failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export function parseWeather(d: Record<string, any>, city: string): Weather | null {
  if (d?.current?.temperature_2m == null || d?.daily?.temperature_2m_max?.[0] == null) return null;
  {
    const c = d.current ?? {};
    const dl = d.daily ?? {};
    const h = d.hourly ?? {};
    const hhmm = (s: unknown) => (typeof s === 'string' ? s.slice(11, 16) : null);
    const sunrise = hhmm(dl.sunrise?.[0]);
    const sunset = hhmm(dl.sunset?.[0]);
    const hourly = HOURS.map((hh) => {
      const i = (h.time as string[] | undefined)?.findIndex((t) => t.slice(11, 13) === hh) ?? -1;
      if (i < 0) return null;
      const time = `${hh}:00`;
      return {
        hour: hh,
        temp: h.temperature_2m[i],
        code: h.weather_code[i],
        precip: h.precipitation_probability?.[i] ?? null,
        isDay: !sunrise || !sunset || (time >= sunrise && time < sunset),
      };
    }).filter((x): x is Weather['hourly'][number] => x !== null);

    const tomorrow = dl.weather_code?.[1] != null && dl.temperature_2m_max?.[1] != null
      ? { code: dl.weather_code[1], tMax: dl.temperature_2m_max[1], tMin: dl.temperature_2m_min?.[1] ?? dl.temperature_2m_max[1] }
      : null;

    return {
      city,
      now: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, wind: c.wind_speed_10m, isDay: c.is_day === 1 },
      day: {
        code: dl.weather_code?.[0], tMax: dl.temperature_2m_max?.[0], tMin: dl.temperature_2m_min?.[0],
        precipProb: dl.precipitation_probability_max?.[0] ?? null, uv: dl.uv_index_max?.[0] ?? null,
        windMax: dl.wind_speed_10m_max?.[0] ?? null, sunrise, sunset,
      },
      hourly,
      tomorrow,
    };
  }
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Ясно';
  if (code === 1) return 'Переважно ясно';
  if (code === 2) return 'Мінлива хмарність';
  if (code === 3) return 'Хмарно';
  if (code === 45 || code === 48) return 'Туман';
  if (code >= 51 && code <= 57) return 'Мряка';
  if (code === 61 || code === 80) return 'Невеликий дощ';
  if (code === 63 || code === 81) return 'Дощ';
  if (code === 65 || code === 82) return 'Злива';
  if (code === 66 || code === 67) return 'Крижаний дощ';
  if (code >= 71 && code <= 77) return 'Сніг';
  if (code === 85 || code === 86) return 'Снігопад';
  if (code >= 95) return 'Гроза';
  return 'Погода';
}

export function weatherIconFor(code: number, isDay: boolean): WeatherIcon {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code === 1 || code === 2) return isDay ? 'sunCloud' : 'moonCloud';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}

/** Одна практична порада щодо тренування надворі. */
export function weatherTrainingHint(w: Weather): string {
  const { tMax, tMin, precipProb, uv, windMax } = w.day;
  if ((precipProb ?? 0) >= 60 || w.day.code >= 95) return 'Ймовірні опади — краще зала або станок';
  if (tMax >= 30) return 'Спека — тренуйся зранку чи ввечері, пий більше';
  if (tMin <= 0) return 'Холодно — одягайся шарами, розминка довша';
  if ((windMax ?? 0) >= 10) return 'Сильний вітер — на вело врахуй зустрічний';
  if ((uv ?? 0) >= 6) return 'Високий УФ — захист від сонця на довгу поїздку';
  return 'Суха погода — гарний день для вело чи пробіжки';
}
