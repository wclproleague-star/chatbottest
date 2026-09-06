'use server';

// Personality: how the bot talks, and how careful it is.
//
// Every save goes through the same door as any other settings change, so the
// persona is checked, a stale edit is refused rather than overwriting somebody,
// and a forbidden list broad enough to refuse everything comes back as a
// warning rather than a silent surprise later.

import { saveSettings, serviceClient, suggestQuestions, toneSamples } from '@sentrybot/core';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/guild';

export type SaveState = { ok?: string; warning?: string; error?: string; id: number } | null;

export async function savePersonality(_prev: SaveState, form: FormData): Promise<SaveState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);

  const topics = String(form.get('forbidden_topics') ?? '')
    .split(/[\n,;]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const outcome = await saveSettings(
    guildId,
    {
      bot_name: String(form.get('bot_name') ?? '').trim() || 'Sentry',
      persona_prompt: String(form.get('persona_prompt') ?? '').trim() || null,
      language: String(form.get('language') ?? '').trim() || null,
      tone_sample: String(form.get('tone_sample') ?? '').trim() || null,
      forbidden_topics: topics,
      max_reply_chars: clamp(Number(form.get('max_reply_chars')), 200, 2000, 900),
      confidence_threshold: clamp(Number(form.get('confidence_threshold')), 0.2, 0.9, 0.55),
      allowed_actions: form.getAll('allowed_actions').map(String),
      self_serve_role_ids: form.getAll('self_serve_role_ids').map(String),
    },
    String(form.get('based_on') ?? '') || null,
  );

  if (!outcome.ok) return { error: outcome.message, id: Date.now() };
  revalidatePath(`/g/${guildId}/personality`);
  return { ok: 'Saved.', warning: outcome.warning, id: Date.now() };
}

/** Three fresh samples in the bot's voice, written from the persona. */
export async function regenerateTones(
  guildId: string,
  persona: string,
): Promise<{ samples: string[] } | { error: string }> {
  await requireMember(guildId);
  const { data: guild } = await serviceClient()
    .from('guilds')
    .select('name')
    .eq('guild_id', guildId)
    .maybeSingle();
  const samples = await toneSamples({ personaPrompt: persona }, guild?.name ?? 'this server');
  return samples.length > 0 ? { samples } : { error: 'Could not think of any just now.' };
}

/** Questions to try, so a change of personality can be seen rather than imagined. */
export async function questionsToTry(guildId: string): Promise<string[]> {
  await requireMember(guildId);
  try {
    const { questions } = await suggestQuestions({ guildId });
    return questions.slice(0, 3);
  } catch {
    return [];
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}
