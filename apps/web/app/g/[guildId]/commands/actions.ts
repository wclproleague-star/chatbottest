'use server';

// Command mode in the dashboard. The same planner the bot uses, so a plan
// reads the same in both places.
//
// The web can plan but it cannot act: Discord is reachable from the bot, not
// from here. Confirming writes the plan down as approved, and the bot picks it
// up and carries it out, then the page shows what actually ran. That keeps the
// one process that holds a Discord connection as the only thing that changes a
// server.

import { cancelCommand, planCommand, recordCommand, serviceClient } from '@sentrybot/core';
import type { GuildShape, Plan } from '@sentrybot/core';
import { revalidatePath } from 'next/cache';
import { displayName, requireMember } from '@/lib/guild';

export type CommandState =
  | { kind: 'plan'; commandId: string; sentences: string[]; itemise: boolean; id: number }
  | { kind: 'question'; question: string; because: string; id: number }
  | { kind: 'refused'; because: string; id: number }
  | { kind: 'sent'; note: string; id: number }
  | { kind: 'error'; error: string; id: number }
  | null;

export async function planIt(_prev: CommandState, form: FormData): Promise<CommandState> {
  const guildId = String(form.get('guild_id') ?? '');
  const request = String(form.get('request') ?? '').trim();
  if (!request) return { kind: 'error', error: 'Say what you want first.', id: Date.now() };

  const { user, role } = await requireMember(guildId);
  const by = {
    id: user.id,
    name: displayName(user),
    isStaff: role === 'editor',
    isOwner: role === 'owner',
  };

  const shape = await shapeOf(guildId);
  if (shape.channels.length === 0 && shape.roles.length === 0) {
    return {
      kind: 'error',
      error: 'Sentry has not read your channels and roles yet. Add it to the server first.',
      id: Date.now(),
    };
  }

  let plan: Plan;
  try {
    plan = await planCommand({ guildId, request, by, shape });
  } catch {
    return { kind: 'error', error: 'Could not work that out just now. Try again.', id: Date.now() };
  }
  const commandId = await recordCommand({ guildId, by, request, plan });

  if (plan.kind === 'refused') return { kind: 'refused', because: plan.because, id: Date.now() };
  if (plan.kind === 'question') {
    return { kind: 'question', question: plan.question, because: plan.because, id: Date.now() };
  }
  return {
    kind: 'plan',
    commandId,
    sentences: plan.steps.map((step) => step.sentence),
    itemise: plan.steps.length > 3,
    id: Date.now(),
  };
}

/** Confirmed here, carried out by the bot: only it can reach Discord. */
export async function confirmIt(_prev: CommandState, form: FormData): Promise<CommandState> {
  const guildId = String(form.get('guild_id') ?? '');
  const commandId = String(form.get('command_id') ?? '');
  await requireMember(guildId);
  const { error } = await serviceClient()
    .from('commands')
    .update({ status: 'planned', ran_at: null })
    .eq('id', commandId)
    .eq('guild_id', guildId);
  if (error) return { kind: 'error', error: 'Could not confirm that. Try again.', id: Date.now() };
  await serviceClient()
    .from('bot_events')
    .insert({ guild_id: guildId, type: 'action', payload: { commandId, confirmed: true } });
  revalidatePath(`/g/${guildId}/commands`);
  return {
    kind: 'sent',
    note: 'Confirmed. Sentry is carrying it out in Discord, and this page will show what ran.',
    id: Date.now(),
  };
}

export async function cancelIt(_prev: CommandState, form: FormData): Promise<CommandState> {
  const guildId = String(form.get('guild_id') ?? '');
  await requireMember(guildId);
  await cancelCommand(String(form.get('command_id') ?? ''));
  revalidatePath(`/g/${guildId}/commands`);
  return {
    kind: 'sent',
    note: 'Cancelled, nothing was changed. What would you like different?',
    id: Date.now(),
  };
}

async function shapeOf(guildId: string): Promise<GuildShape> {
  const db = serviceClient();
  const [{ data: meta }, { data: settings }] = await Promise.all([
    db
      .from('guild_discord_meta')
      .select('channels, categories, roles')
      .eq('guild_id', guildId)
      .maybeSingle(),
    db
      .from('guild_settings')
      .select('allowed_actions, mod_role_id')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ]);
  const roles = (meta?.roles ?? []) as { id: string; name: string }[];
  const modRole = roles.find((r) => r.id === settings?.mod_role_id);
  return {
    channels: (meta?.channels ?? []) as { id: string; name: string }[],
    categories: (meta?.categories ?? []) as { id: string; name: string }[],
    roles,
    allowedActions: settings?.allowed_actions ?? [],
    modRole,
  };
}
