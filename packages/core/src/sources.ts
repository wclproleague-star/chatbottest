// The data sources a guild has, and how the loop calls them.
//
// What Kalvard can look up is not a list written into a prompt: it is whatever
// the owner has configured here. Each entry becomes a tool the loop may call,
// described in the owner's own words, so adding a source makes questions
// answerable that were not answerable yesterday, with no change to any prompt
// and none to the loop. A kind that is not registered simply cannot be called,
// and the honest refusal stands.
//
// The first kinds arrive with build order line 12b. Until then the registry is
// empty on purpose: the path is real, the sources are not there yet.

import type { Json } from './database.types';

/** One source, as the owner configured it. */
export type DataSource = {
  /** Stable id, used as the tool's argument. */
  id: string;
  /** What it is called, in the owner's words: "the tournament schedule". */
  name: string;
  /** What it can answer, in the owner's words: "fixtures, times and results". */
  answers: string;
  /** Which fetcher runs it. A kind with no fetcher registered is inert. */
  kind: string;
  /** Whatever that kind needs: an endpoint, a competition id, a sheet name. */
  config: Record<string, Json>;
};

/** A fetcher for one kind of source. Registered by the code that implements it. */
export type Fetcher = (input: {
  source: DataSource;
  question: string;
  guildId: string;
}) => Promise<string>;

const FETCHERS = new Map<string, Fetcher>();

/** Registers the fetcher for a kind. Called by whatever implements that kind. */
export function registerFetcher(kind: string, fetcher: Fetcher): void {
  FETCHERS.set(kind, fetcher);
}

/** The sources this guild has that something can actually run. */
export function runnable(sources: DataSource[]): DataSource[] {
  return sources.filter((s) => FETCHERS.has(s.kind));
}

/**
 * Runs one source and returns what it said, or null when nothing can run it.
 * A source that throws is a source that answered nothing: the caller falls
 * back to saying plainly that it could not look this up.
 */
export async function fetchFrom(
  sources: DataSource[],
  sourceId: string,
  question: string,
  guildId: string,
): Promise<string | null> {
  const source = sources.find((s) => s.id === sourceId);
  const fetcher = source ? FETCHERS.get(source.kind) : undefined;
  if (!source || !fetcher) return null;
  try {
    const said = await fetcher({ source, question, guildId });
    return said.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Runs a source once and says what happened in words an owner can act on. The
 * screen where a source is added uses this: a source that cannot be tested
 * before it is saved is a source nobody trusts.
 */
export async function testSource(
  source: DataSource,
  question: string,
  guildId: string,
): Promise<{ ok: true; sample: string } | { ok: false; reason: string }> {
  const fetcher = FETCHERS.get(source.kind);
  if (!fetcher) return { ok: false, reason: `Kalvard has no fetcher for "${source.kind}".` };
  try {
    const said = (await fetcher({ source, question, guildId })).trim();
    return said
      ? { ok: true, sample: said.slice(0, 800) }
      : { ok: false, reason: 'It answered, but with nothing in it.' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'It could not be reached.' };
  }
}

/** The kinds something has registered, for the screen that offers them. */
export function kinds(): string[] {
  return [...FETCHERS.keys()].sort();
}

/** Reads the column, keeping only entries shaped like a source. */
export function parseSources(value: Json | null | undefined): DataSource[] {
  if (!Array.isArray(value)) return [];
  const out: DataSource[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, Json>;
    const { id, name, answers, kind } = row;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (typeof answers !== 'string' || typeof kind !== 'string') continue;
    const config = row.config;
    out.push({
      id,
      name,
      answers,
      kind,
      config:
        config && typeof config === 'object' && !Array.isArray(config)
          ? (config as Record<string, Json>)
          : {},
    });
  }
  return out;
}
