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
//
// And the place has to be a place. Asked "what's the weather like", the loop
// sent the whole sentence here, the geocoder helpfully found a town in
// Arkansas actually called Weather, and a member was told it was 15 degrees
// and clear — for somewhere neither of them had ever heard of. A question
// missing the one thing it needs is a question to ask back, not a gap to fill
// with whatever the world happens to contain, so the words that make up the
// question are stripped and what is left has to be a name.

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

/**
 * The words a weather question is made of, in both languages we answer in.
 *
 * Every one of them is also, somewhere, the name of a town: Weather in
 * Arkansas, Here in Somalia, Nowhere in Oklahoma. Stripping them first is what
 * stops a question with no place in it from finding one anyway.
 */
const NOT_A_PLACE = new Set([
  'a',
  'about',
  'actuellement',
  'and',
  'at',
  'aujourd',
  "aujourd'hui",
  'be',
  'but',
  'ca',
  'ce',
  'cet',
  'cette',
  'chez',
  'cold',
  'currently',
  'current',
  'dehors',
  'de',
  'do',
  'du',
  'en',
  'est',
  'et',
  'fait',
  'for',
  'forecast',
  'ggs',
  'here',
  'hot',
  'how',
  'il',
  'in',
  'is',
  'it',
  'its',
  "it's",
  'jour',
  'la',
  'le',
  'les',
  'like',
  'maintenant',
  'me',
  'meteo',
  'météo',
  'moment',
  'now',
  'of',
  'oh',
  'ok',
  'on',
  'outside',
  'please',
  'plz',
  'quel',
  'quelle',
  'rain',
  'raining',
  'right',
  'say',
  'so',
  'sun',
  'sunny',
  'tell',
  'temp',
  'temperature',
  'température',
  'temps',
  'the',
  'there',
  'this',
  'to',
  'today',
  'tonight',
  'un',
  'une',
  'weather',
  'what',
  'whats',
  "what's",
  'where',
  'y',
  'you',
  'your',
]);

/** How a place is introduced, in both languages. */
const BEFORE_A_PLACE = new Set([
  'in',
  'at',
  'near',
  'around',
  'from',
  'à',
  'a',
  'en',
  'sur',
  'dans',
]);

/** A message this short, with a word left in it, is the place itself. */
const SHORT = 3;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[?!.,;:"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The place a question is asking about, or null when it names none.
 *
 * People introduce a place the same two ways every time: after a preposition —
 * "in Paris", "à Lyon" — or on its own, as the whole message. Anything else is
 * a sentence about the weather with no place in it, and the honest answer to
 * that is a question, not a lookup. Stripping question words alone was not
 * enough: "fine fine... what's the weather like" left "fine fine" behind, and
 * there is a Fine in Italy.
 *
 * Null is not a failure. It is the funnel working: a member who has not said
 * where is asked where, and nothing is looked up until they have.
 */
export function placeAsked(question: string, said?: string): string | null {
  const all = words(question);
  const at = all.map((word) => BEFORE_A_PLACE.has(word)).lastIndexOf(true);
  const candidate = at >= 0 ? all.slice(at + 1) : all.length <= SHORT ? all : [];
  const place = candidate
    .filter((word) => !NOT_A_PLACE.has(word))
    .join(' ')
    .trim();
  if (place.length < 2) return null;
  // The question is the model's paraphrase of the message, and a paraphrase
  // can introduce a place nobody named: asked with no place in the message, it
  // reached for the member's own name and reported the weather in Kestrel. So
  // the name has to be in what they actually wrote.
  if (said !== undefined && !mentions(said, place)) return null;
  return place;
}

/** Whether the member's own message contains this name, accents aside. */
function mentions(said: string, place: string): boolean {
  const flat = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ');
  return flat(said).includes(flat(place).trim());
}

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

registerFetcher('open_meteo', async ({ question, said }) => {
  const place = placeAsked(question, said);
  // Nothing to look up yet. The loop reads this and asks, which is what the
  // funnel says to do with a question missing the one thing it needs.
  if (!place) {
    return 'No place was named, so there is nothing to look up yet. Ask them which place they mean, in one short line, and look nothing up until they say.';
  }
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
