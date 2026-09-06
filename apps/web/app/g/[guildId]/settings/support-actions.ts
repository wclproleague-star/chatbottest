'use server';

// Where members get help, as a conversation: one question at a time, each
// with a default, then the plan as sentences, then a yes. The web asks and
// plans; only the bot creates, so confirming here writes the plan down as
// approved and the bot carries it out — the same door as Command mode, and
// the same log of who agreed to what.

import {
  loadSupport,
  nextSupportQuestion,
  recordCommand,
  serviceClient,
  supportPlan,
} from '@kalvard/core';
import type { GuildShape, SupportAnswers, SupportMode, SupportQuestion } from '@kalvard/core';
import { revalidatePath } from 'next/cache';
import { displayName, requireMember } from '@/lib/guild';

export type SupportState =
  | {
      kind: 'question';
      mode: SupportMode;
      answers: SupportAnswers;
      question: SupportQuestion;
      id: number;
    }
  | {
      kind: 'plan';
      mode: SupportMode;
      answers: SupportAnswers;
      commandId: string;
      sentences: string[];
      archived: string[];
      id: number;
    }
  | { kind: 'sent'; note: string; id: number }
  | { kind: 'error'; error: string; mode?: SupportMode; answers?: SupportAnswers; id: number }
  | null;

const MODES: SupportMode[] = ['tickets', 'help_channel', 'existing_channel'];

/** One step of the conversation: take the answer given, ask the next thing or show the plan. */
export async function supportStep(_prev: SupportState, form: FormData): Promise<SupportState> {
  const guildId = String(form.get('guild_id') ?? '');
  const { user, role } = await requireMember(guildId);
  const mode = String(form.get('mode') ?? '') as SupportMode;
  if (!MODES.includes(mode))
    return { kind: 'error', error: 'Pick one of the three first.', id: Date.now() };

  let answers: SupportAnswers = {};
  try {
    answers = JSON.parse(String(form.get('answers') ?? '{}')) as SupportAnswers;
  } catch {
    answers = {};
  }
  const key = String(form.get('key') ?? '');
  const answer = String(form.get('answer') ?? '').trim();
  if (key) (answers as Record<string, string>)[key] = answer;

  const shape = await shapeOf(guildId);
  const next = nextSupportQuestion(mode, answers, shape);
  if (next) return { kind: 'question', mode, answers, question: next, id: Date.now() };

  const current = await loadSupport(guildId);
  const plan = supportPlan({ mode, answers, shape, current: current.setup });
  if (plan.missing) return { kind: 'error', error: plan.missing, mode, answers, id: Date.now() };

  const commandId = await recordCommand({
    guildId,
    by: {
      id: user.id,
      name: displayName(user),
      isStaff: role === 'editor',
      isOwner: role === 'owner',
    },
    request: `Where members get help: ${mode.replace('_', ' ')}`,
    plan: { kind: 'plan', steps: plan.steps, touches: plan.steps.length },
  });
  return {
    kind: 'plan',
    mode,
    answers,
    commandId,
    sentences: plan.steps.map((s) => s.sentence),
    archived: plan.archived,
    id: Date.now(),
  };
}

/** The yes. Nothing was created until here, and the bot does the creating. */
export async function supportConfirm(_prev: SupportState, form: FormData): Promise<SupportState> {
  const guildId = String(form.get('guild_id') ?? '');
  const commandId = String(form.get('command_id') ?? '');
  await requireMember(guildId);
  const db = serviceClient();
  const { error } = await db
    .from('commands')
    .update({ status: 'planned', ran_at: null })
    .eq('id', commandId)
    .eq('guild_id', guildId);
  if (error) return { kind: 'error', error: 'Could not confirm that. Try again.', id: Date.now() };
  await db
    .from('bot_events')
    .insert({ guild_id: guildId, type: 'action', payload: { commandId, confirmed: true } });
  revalidatePath(`/g/${guildId}/settings`);
  return {
    kind: 'sent',
    note: 'Confirmed. Kalvard is setting it up in Discord; this page shows the choice once it has.',
    id: Date.now(),
  };
}

/** What the server has, as the planner needs it: from the bot's last sync. */
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
      .select('allowed_actions, mod_role_id, data_sources')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ]);
  const roles = (meta?.roles ?? []) as { id: string; name: string }[];
  const modRole = roles.find((r) => r.id === settings?.mod_role_id);
  return {
    channels: (meta?.channels ?? []) as { id: string; name: string }[],
    categories: ((meta as { categories?: unknown } | null)?.categories ?? []) as {
      id: string;
      name: string;
    }[],
    roles,
    allowedActions: settings?.allowed_actions ?? [],
    modRole,
  };
}
