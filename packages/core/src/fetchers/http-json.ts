// The generic kind: any JSON endpoint an owner can point at.
//
// This is what makes a data source configuration rather than code. A league
// with its own API, a sheet published as JSON, a status page: the owner gives
// the address and says what it answers, and the loop can call it the same day.
//
// What comes back is flattened into short lines rather than handed to the
// model as raw JSON. A model reading a nested object invents paths through it;
// a model reading "matches.0.time: 19:00" reads a fact.

import { DEFAULT_TIMEOUT_MS, getJson } from './http';
import { registerFetcher } from '../sources';

/** How much of the answer is worth showing. Past this nobody reads it anyway. */
const MAX_LINES = 40;
const MAX_VALUE = 200;

/**
 * One JSON value as lines a model can quote. Arrays keep their index so two
 * items are never confused, and long strings are cut rather than dropped.
 */
export function summarise(value: unknown, path = '', lines: string[] = []): string[] {
  if (lines.length >= MAX_LINES) return lines;
  if (value === null || value === undefined) return lines;

  if (Array.isArray(value)) {
    value
      .slice(0, 10)
      .forEach((item, i) => summarise(item, path ? `${path}.${i}` : String(i), lines));
    if (value.length > 10) lines.push(`${path}: ${value.length} items in all`);
    return lines;
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      summarise(inner, path ? `${path}.${key}` : key, lines);
      if (lines.length >= MAX_LINES) break;
    }
    return lines;
  }
  const text = String(value).replace(/\s+/g, ' ').slice(0, MAX_VALUE);
  if (text) lines.push(`${path}: ${text}`);
  return lines;
}

registerFetcher('http_json', async ({ source, question }) => {
  const config = source.config as Record<string, unknown>;
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('This source has no address yet.');

  // {question} lets an owner point at a search endpoint without any code.
  const asked = url.includes('{question}')
    ? url.replace('{question}', encodeURIComponent(question))
    : url;
  const apiKey = typeof config.apiKey === 'string' && config.apiKey ? config.apiKey : undefined;
  const body = await getJson(asked, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
  });

  const lines = summarise(body);
  return lines.length > 0
    ? lines.join(String.fromCharCode(10))
    : 'It answered, but with nothing in it.';
});
