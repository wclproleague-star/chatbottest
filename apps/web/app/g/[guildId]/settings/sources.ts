'use server';

// The sources a server can look things up in.
//
// A source is added, tested and removed here, and testing is not optional
// decoration: it runs the real fetcher and shows what came back, so nobody
// finds out in a channel that the address was wrong. The key is written but
// never read back to the browser.

import { parseSources, saveSettings, serviceClient, testSource } from '@kalvard/core';
import type { DataSource } from '@kalvard/core';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/guild';

export type SourceState = { ok?: string; sample?: string; error?: string; id: number } | null;

/** What an owner fills in, per kind. Only the kinds something can actually run. */
export const SOURCE_KINDS: { kind: string; label: string; needsAddress: boolean }[] = [
  { kind: 'rift_legends', label: 'Rift Legends (matches and rosters)', needsAddress: true },
  { kind: 'open_meteo', label: 'The weather, anywhere', needsAddress: false },
  { kind: 'http_json', label: 'Any JSON address', needsAddress: true },
];

export async function addSource(_prev: SourceState, form: FormData): Promise<SourceState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);

  const source = fromForm(form);
  if (!source.name || !source.answers) {
    return fail('Give it a name and say what it can answer.');
  }
  const kind = SOURCE_KINDS.find((k) => k.kind === source.kind);
  if (!kind) return fail('Kalvard has no fetcher for that.');

  // Tested before it is saved, always.
  const tried = await testSource(source, 'what is coming up?', guildId);
  if (!tried.ok) return fail(`It did not work: ${tried.reason}`);

  const current = await load(guildId);
  const next = [...current.sources.filter((s) => s.id !== source.id), source];
  const outcome = await saveSettings(guildId, { data_sources: next }, current.updatedAt);
  if (!outcome.ok) return fail(outcome.message);

  revalidatePath(`/g/${guildId}/settings`);
  return { ok: `Added. It answered with: `, sample: tried.sample, id: Date.now() };
}

export async function trySource(_prev: SourceState, form: FormData): Promise<SourceState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);
  const sourceId = String(form.get('source_id') ?? '');
  const question = String(form.get('question') ?? '').trim() || 'what is coming up?';

  const { sources } = await load(guildId);
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return fail('That source is gone.');
  const tried = await testSource(source, question, guildId);
  return tried.ok
    ? { ok: 'It answered:', sample: tried.sample, id: Date.now() }
    : fail(`It did not work: ${tried.reason}`);
}

export async function removeSource(_prev: SourceState, form: FormData): Promise<SourceState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);
  const sourceId = String(form.get('source_id') ?? '');
  const current = await load(guildId);
  const outcome = await saveSettings(
    guildId,
    { data_sources: current.sources.filter((s) => s.id !== sourceId) },
    current.updatedAt,
  );
  if (!outcome.ok) return fail(outcome.message);
  revalidatePath(`/g/${guildId}/settings`);
  return { ok: 'Removed. Questions it used to answer go back to the honest line.', id: Date.now() };
}

async function load(guildId: string): Promise<{ sources: DataSource[]; updatedAt: string | null }> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('data_sources, updated_at')
    .eq('guild_id', guildId)
    .maybeSingle();
  return { sources: parseSources(data?.data_sources ?? null), updatedAt: data?.updated_at ?? null };
}

function fromForm(form: FormData): DataSource {
  const name = String(form.get('name') ?? '').trim();
  return {
    id: String(form.get('source_id') ?? '').trim() || slug(name),
    name,
    answers: String(form.get('answers') ?? '').trim(),
    kind: String(form.get('kind') ?? '').trim(),
    config: {
      baseUrl: String(form.get('base_url') ?? '').trim(),
      // The generic kind reads `url`; the named kinds read `baseUrl`.
      url: String(form.get('base_url') ?? '').trim(),
      apiKey: String(form.get('api_key') ?? '').trim() || undefined,
    } as DataSource['config'],
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || `source-${Date.now()}`
  );
}

function fail(error: string): SourceState {
  return { error, id: Date.now() };
}
