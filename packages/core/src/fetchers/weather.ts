// The first real data source: the current weather, from Open-Meteo.
//
// It is here because it is the shape every later source has to fit: free, no
// key, one hop, a hard timeout, and an answer a member can check in a second by
// looking out of the window. Nothing about the weather is written into a
// prompt; the guild has this source or it does not, and what the loop knows
// about it is the name and the description the owner gave it.
//
// Two allowlisted hosts and no user-supplied URL: the place name is the only
// thing that reaches the network, as a query parameter.

import { registerFetcher } from '../sources';

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
/** Long enough for two hops on a bad day, short enough that a member waits. */
const TIMEOUT_MS = 4000;

type Place = { name: string; country?: string; latitude: number; longitude: number };

/** What the code means, in words a member would use. */
const CONDITIONS = new Map<number, string>([
  [0, 'clear'],
  [1, 'mostly clear'],
  [2, 'partly cloudy'],
  [3, 'overcast'],
  [45, 'foggy'],
  [48, 'freezing fog'],
  [51, 'light drizzle'],
  [53, 'drizzle'],
  [55, 'heavy drizzle'],
  [61, 'light rain'],
  [63, 'rain'],
  [65, 'heavy rain'],
  [71, 'light snow'],
  [73, 'snow'],
  [75, 'heavy snow'],
  [80, 'rain showers'],
  [81, 'rain showers'],
  [82, 'violent rain showers'],
  [95, 'a thunderstorm'],
  [96, 'a thunderstorm with hail'],
  [99, 'a thunderstorm with hail'],
]);

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** The place the member named, or null when no such place exists. */
async function geocode(place: string): Promise<Place | null> {
  const url = `${GEOCODE}?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const body = (await getJson(url)) as { results?: Place[] };
  return body.results?.[0] ?? null;
}

registerFetcher('open_meteo', async ({ question }) => {
  const place = question.trim();
  if (!place) return '';
  const found = await geocode(place);
  if (!found) return `There is no place called "${place}" in the weather service.`;
  const url =
    `${FORECAST}?latitude=${found.latitude}&longitude=${found.longitude}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m';
  const body = (await getJson(url)) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    current_units?: { temperature_2m?: string; wind_speed_10m?: string };
  };
  const now = body.current;
  if (!now || typeof now.temperature_2m !== 'number') {
    return `The weather service returned nothing for ${found.name}.`;
  }
  const degrees = body.current_units?.temperature_2m ?? '°C';
  const wind = body.current_units?.wind_speed_10m ?? 'km/h';
  const condition = CONDITIONS.get(now.weather_code ?? -1) ?? 'unsettled';
  const feels =
    typeof now.apparent_temperature === 'number' &&
    Math.round(now.apparent_temperature) !== Math.round(now.temperature_2m)
      ? `, feels like ${Math.round(now.apparent_temperature)}${degrees}`
      : '';
  const breeze =
    typeof now.wind_speed_10m === 'number'
      ? `, wind ${Math.round(now.wind_speed_10m)} ${wind}`
      : '';
  const where = found.country ? `${found.name}, ${found.country}` : found.name;
  return `${where} right now: ${Math.round(now.temperature_2m)}${degrees}${feels}, ${condition}${breeze}.`;
});
