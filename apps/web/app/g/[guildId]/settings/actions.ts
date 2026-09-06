'use server';

// Everything that is not personality: where it answers, who it wakes, what it
// may look up, what it may spend, and the two things that cannot be undone.

import { DEFAULT_LIMITS, saveSettings, serviceClient } from '@kalvard/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/guild';

export type SettingsState = { ok?: string; warning?: string; error?: string; id: number } | null;

export async function saveGuildSettings(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);

  const modRole = String(form.get('mod_role_id') ?? '').trim();
  const outcome = await saveSettings(
    guildId,
    {
      allowed_channel_ids: form.getAll('allowed_channel_ids').map(String),
      mod_role_id: modRole || null,
      mod_channel_id: String(form.get('mod_channel_id') ?? '').trim() || null,
      intro_channel_id: String(form.get('intro_channel_id') ?? '').trim() || null,
      intro_message: String(form.get('intro_message') ?? '').trim() || null,
      fallback_mode: form.get('fallback_mode') === 'quiet_queue' ? 'quiet_queue' : 'ping_role',
      scope: form.get('scope') === 'server_only' ? 'server_only' : 'open',
      timezone: String(form.get('timezone') ?? '').trim() || null,
      limits: {
        ...DEFAULT_LIMITS,
        memberBurst: number(form.get('member_burst'), DEFAULT_LIMITS.memberBurst),
        monthlyAnswers: number(form.get('monthly_answers'), DEFAULT_LIMITS.monthlyAnswers),
      },
    },
    String(form.get('based_on') ?? '') || null,
  );
  if (!outcome.ok) return { error: outcome.message, id: Date.now() };
  revalidatePath(`/g/${guildId}/settings`);
  return { ok: 'Saved.', warning: outcome.warning, id: Date.now() };
}

/**
 * Removing the bot: the guild is marked, its open conversations stop, and the
 * data is kept for thirty days in case they come back. Nothing is deleted here.
 */
export async function removeBot(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const guildId = String(form.get('guild_id') ?? '');
  if (
    String(form.get('confirm') ?? '')
      .trim()
      .toLowerCase() !== 'remove'
  ) {
    return { error: 'Type remove to confirm.', id: Date.now() };
  }
  await requireMember(guildId);
  const db = serviceClient();
  await db
    .from('guilds')
    .update({ bot_installed: false, uninstalled_at: new Date().toISOString() })
    .eq('guild_id', guildId);
  await db.from('conversations').delete().eq('guild_id', guildId);
  revalidatePath(`/g/${guildId}/settings`);
  return {
    ok: 'Marked as removed. Kick it from Discord to finish, and your data is kept for 30 days.',
    id: Date.now(),
  };
}

/** Deleting everything. The guild row goes, and every table cascades from it. */
export async function deleteEverything(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const guildId = String(form.get('guild_id') ?? '');
  const guildName = String(form.get('guild_name') ?? '').trim();
  if (String(form.get('confirm') ?? '').trim() !== guildName) {
    return { error: `Type ${guildName} exactly to confirm.`, id: Date.now() };
  }
  await requireMember(guildId);
  const { error } = await serviceClient().from('guilds').delete().eq('guild_id', guildId);
  if (error) return { error: 'Could not delete it. Try again.', id: Date.now() };
  redirect('/servers');
}

function number(value: FormDataEntryValue | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
