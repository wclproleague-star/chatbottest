'use server';

// Setting up a bot, from either side.
//
// Talking to it and filling in the form write the same draft into the same
// session row, so an owner can switch between them and lose nothing. Nothing
// reaches guild_settings until they save at the end, and the persona is
// checked before it is written, as it is everywhere else.

import { ingest, onboard, saveSettings, serviceClient } from '@sentrybot/core';
import type { DraftConfig } from '@sentrybot/core';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/guild';

export type ChatState = {
  message?: string;
  quickReplies?: string[];
  config?: DraftConfig;
  done?: boolean;
  error?: string;
  /** Changes with every reply, so the client can tell two identical ones apart. */
  id: number;
};

/** Starts a session, or picks up the one already open for this owner. */
export async function startSession(
  guildId: string,
  mode: 'chat' | 'form',
): Promise<{ sessionId: string } | { error: string }> {
  const { user } = await requireMember(guildId);
  const db = serviceClient();
  const { data: open } = await db
    .from('onboarding_sessions')
    .select('id')
    .eq('guild_id', guildId)
    .eq('user_id', user.id)
    .eq('completed', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) {
    await db.from('onboarding_sessions').update({ mode }).eq('id', open.id);
    return { sessionId: open.id };
  }
  const { data, error } = await db
    .from('onboarding_sessions')
    .insert({ guild_id: guildId, user_id: user.id, mode })
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not start the setup. Try again.' };
  return { sessionId: data.id };
}

/** One turn of the conversation. An empty `said` opens it. */
export async function say(_prev: ChatState | null, form: FormData): Promise<ChatState> {
  const guildId = String(form.get('guild_id') ?? '');
  const sessionId = String(form.get('session_id') ?? '');
  const said = String(form.get('said') ?? '').trim();
  await requireMember(guildId);
  try {
    const result = await onboard({ sessionId, said: said || undefined });
    return {
      message: result.message,
      quickReplies: result.quickReplies,
      config: result.updatedConfig,
      done: result.done,
      id: Date.now(),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.', id: Date.now() };
  }
}

/** The form writes the same draft the conversation does. */
export async function saveDraft(
  guildId: string,
  sessionId: string,
  config: DraftConfig,
): Promise<{ ok: true } | { error: string }> {
  await requireMember(guildId);
  const { error } = await serviceClient()
    .from('onboarding_sessions')
    .update({ draft_config: config, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
  return error ? { error: 'Could not save that. Try again.' } : { ok: true };
}

/**
 * The end of setup: the draft becomes the guild's settings, and anything the
 * owner pasted along the way becomes knowledge. The persona goes through the
 * same check as a later edit, so a refused one is caught here rather than in
 * the channel.
 */
export async function applyDraft(
  guildId: string,
  sessionId: string,
  config: DraftConfig,
): Promise<{ ok: true; warning?: string } | { error: string }> {
  const { user } = await requireMember(guildId);
  const db = serviceClient();

  const { data: current } = await db
    .from('guild_settings')
    .select('updated_at')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (!current) {
    await db.from('guild_settings').insert({ guild_id: guildId });
  }
  const { data: fresh } = await db
    .from('guild_settings')
    .select('updated_at')
    .eq('guild_id', guildId)
    .maybeSingle();

  const outcome = await saveSettings(
    guildId,
    {
      bot_name: config.botName ?? 'Sentry',
      persona_prompt: config.personaPrompt ?? null,
      language: languageOf(config.language),
      tone_sample: config.toneSample ?? null,
      forbidden_topics: config.forbiddenTopics ?? [],
    },
    fresh?.updated_at ?? null,
  );
  if (!outcome.ok) return { error: outcome.message };

  for (const doc of config.knowledge ?? []) {
    const { data: created } = await db
      .from('documents')
      .insert({
        guild_id: guildId,
        title: doc.title,
        source_type: 'paste',
        raw_text: doc.text,
        status: 'processing',
        created_by: user.id,
      })
      .select('id')
      .single();
    if (created) await ingest({ guildId, documentId: created.id });
  }

  await db.from('onboarding_sessions').update({ completed: true }).eq('id', sessionId);
  revalidatePath(`/g/${guildId}/onboarding`);
  return { ok: true, warning: outcome.warning };
}

/** The finish-setup screen: real channels and roles, chosen and saved. */
export async function finishSetup(
  _prev: { error?: string; ok?: boolean; id: number } | null,
  form: FormData,
): Promise<{ error?: string; ok?: boolean; id: number }> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);
  const db = serviceClient();
  const answerIn = form.getAll('answer_in').map(String).filter(Boolean);
  const modRole = String(form.get('mod_role') ?? '').trim();
  const modChannel = String(form.get('mod_channel') ?? '').trim();
  if (!modRole)
    return { error: 'Choose the role Sentry should wake when it is not sure.', id: Date.now() };

  const { data: current } = await db
    .from('guild_settings')
    .select('updated_at')
    .eq('guild_id', guildId)
    .maybeSingle();
  const outcome = await saveSettings(
    guildId,
    {
      allowed_channel_ids: answerIn,
      mod_role_id: modRole,
      mod_channel_id: modChannel || null,
    },
    current?.updated_at ?? null,
  );
  if (!outcome.ok) return { error: outcome.message, id: Date.now() };

  await db.from('guilds').update({ setup_completed: true }).eq('guild_id', guildId);
  revalidatePath(`/g/${guildId}`);
  return { ok: true, id: Date.now() };
}

/** Whether the bot has been added to the server yet, polled by the client. */
export async function botArrived(guildId: string): Promise<boolean> {
  await requireMember(guildId);
  const { data } = await serviceClient()
    .from('guilds')
    .select('bot_installed')
    .eq('guild_id', guildId)
    .maybeSingle();
  return Boolean(data?.bot_installed);
}

/** "The language each member writes in" is stored as no language at all. */
function languageOf(said: string | undefined): string | null {
  const value = (said ?? '').trim();
  if (!value) return null;
  return /each member|their own|whatever they|the member/i.test(value) ? null : value;
}
