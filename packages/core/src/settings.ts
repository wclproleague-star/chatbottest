// Saving a guild's settings, safely, when two people may be editing them.
//
// Two moderators with the settings page open will overwrite each other without
// noticing: the second save wins and the first person's change is gone with no
// error anywhere. So a save carries the updated_at it was based on, and a save
// based on a version that is no longer current is refused and told what to do.

import type { Database, Json } from './database.types';
import { checkForbidden, checkPersona } from './persona';
import { serviceClient } from './supabase';

type SettingsRow = Database['public']['Tables']['guild_settings']['Row'];
export type SettingsPatch = Partial<Omit<SettingsRow, 'guild_id' | 'updated_at'>>;

export type SaveOutcome =
  | { ok: true; updatedAt: string; warning?: string }
  /** Somebody else saved since this edit began. Nothing was written. */
  | { ok: false; reason: 'conflict'; message: string; theirs: SettingsRow }
  /** The persona asked for something a persona may not do. Nothing was written. */
  | { ok: false; reason: 'persona'; message: string };

/**
 * Writes the patch, but only if nothing else has been written since
 * `basedOn`. A persona is checked before anything is saved, so an owner is
 * told at once rather than finding out from a member.
 */
export async function saveSettings(
  guildId: string,
  patch: SettingsPatch,
  basedOn: string | null,
): Promise<SaveOutcome> {
  const db = serviceClient();

  if (typeof patch.persona_prompt === 'string') {
    const verdict = await checkPersona(patch.persona_prompt);
    if (!verdict.ok) return { ok: false, reason: 'persona', message: verdict.reason };
  }

  const now = new Date().toISOString();
  let query = db
    .from('guild_settings')
    .update({ ...patch, updated_at: now } as SettingsPatch & { updated_at: string })
    .eq('guild_id', guildId);
  // A save that knows what it is replacing may only replace that.
  query = basedOn ? query.eq('updated_at', basedOn) : query;
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw new Error(`Could not save the settings: ${error.message}`);

  if (!data) {
    const { data: theirs } = await db
      .from('guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();
    return {
      ok: false,
      reason: 'conflict',
      message:
        'Somebody else saved these settings while you were editing. Nothing was changed. Reload to see theirs, then make your change again.',
      theirs: theirs as SettingsRow,
    };
  }

  const warning = Array.isArray(patch.forbidden_topics)
    ? await checkForbidden((patch.forbidden_topics ?? []) as string[])
    : '';
  return { ok: true, updatedAt: now, warning: warning || undefined };
}

/** Lets Sentry answer from a document whose personal details the owner accepted. */
export async function approveDocument(guildId: string, documentId: string): Promise<void> {
  const db = serviceClient();
  await db
    .from('documents')
    .update({ review_status: 'approved' })
    .eq('guild_id', guildId)
    .eq('id', documentId);
  await db
    .from('chunks')
    .update({ blocked: false, blocked_reason: null } as { blocked: boolean; blocked_reason: null })
    .eq('guild_id', guildId)
    .eq('document_id', documentId);
}

/** What is waiting on the owner: documents held back, and settings pointing at nothing. */
export async function needsOwner(guildId: string): Promise<{
  documents: { id: string; title: string | null; reason: string | null }[];
  settingsIssues: Json | null;
}> {
  const db = serviceClient();
  const { data: documents } = await db
    .from('documents')
    .select('id, title')
    .eq('guild_id', guildId)
    .eq('review_status', 'needs_review');
  const held = await Promise.all(
    (documents ?? []).map(async (doc) => {
      const { data: chunk } = await db
        .from('chunks')
        .select('blocked_reason')
        .eq('document_id', doc.id)
        .eq('blocked', true)
        .limit(1)
        .maybeSingle();
      return { id: doc.id, title: doc.title, reason: chunk?.blocked_reason ?? null };
    }),
  );
  const { data: issue } = await db
    .from('bot_events')
    .select('payload')
    .eq('guild_id', guildId)
    .eq('type', 'settings_issue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { documents: held, settingsIssues: issue?.payload ?? null };
}
