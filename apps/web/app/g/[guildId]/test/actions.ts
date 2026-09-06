'use server';

// The test chat runs the real thing, as a rehearsal.
//
// Reads happen for real: the knowledge is searched, the guild's self-serve
// roles are listed, a roster proof is read from the actual document. Writes
// never happen. Each one comes back as what would have been done, with the
// values it would have used, and the page shows it as a "would have" line.
// Nothing here can change the server, which is what makes it safe to try.

import { converse, serviceClient, suggestQuestions } from '@sentrybot/core';
import type { ConversationResult, Effects, HistoryTurn } from '@sentrybot/core';
import { displayName, requireMember } from '@/lib/guild';

export type AskResult = { result: ConversationResult } | { error: string };
export type SuggestOutcome = { questions: string[] } | { error: string };

const MAX_QUESTION = 500;
const MAX_HISTORY = 12;

export async function ask(
  guildId: string,
  question: string,
  history: HistoryTurn[],
  conversationId: string,
): Promise<AskResult> {
  const q = question.trim().slice(0, MAX_QUESTION);
  if (!q) return { error: 'Ask something first.' };
  const { user } = await requireMember(guildId);
  try {
    const result = await converse({
      guildId,
      // Kept apart from anything happening in Discord, and per rehearsal.
      conversationId: `dry-run:${conversationId}`,
      userId: user.id,
      askerName: displayName(user),
      message: q,
      history: history.slice(-MAX_HISTORY),
      dryRun: true,
      effects: readOnlyEffects(guildId),
    });
    return { result };
  } catch {
    return { error: 'Sentry could not answer just now. Try again in a moment.' };
  }
}

/**
 * What the loop may do from the web: read the guild's own record of its
 * channels and roles, and nothing else. The writes are unreachable rather than
 * merely unused, so a mistake in the loop cannot change a real server from
 * here.
 */
function readOnlyEffects(guildId: string): Effects {
  const meta = async (): Promise<{ channels: NamedId[]; roles: NamedId[] }> => {
    const { data } = await serviceClient()
      .from('guild_discord_meta')
      .select('channels, roles')
      .eq('guild_id', guildId)
      .maybeSingle();
    return {
      channels: (data?.channels ?? []) as NamedId[],
      roles: (data?.roles ?? []) as NamedId[],
    };
  };
  return {
    async listRoles() {
      const [{ roles }, { data: settings }] = await Promise.all([
        meta(),
        serviceClient()
          .from('guild_settings')
          .select('self_serve_role_ids')
          .eq('guild_id', guildId)
          .maybeSingle(),
      ]);
      const allowed = new Set(settings?.self_serve_role_ids ?? []);
      return roles.filter((role) => allowed.has(role.id));
    },
    // Whether a member holds a role or can see a channel is only knowable in
    // Discord; the loop is told that and reports it as a check that would run
    // there, so nothing here has to pretend to know.
    async memberHasRole() {
      return false;
    },
    async memberInChannel() {
      return false;
    },
    async assignRole() {
      return { ok: false, reason: 'unknown', detail: 'a rehearsal never assigns' };
    },
    async channelName(channelId) {
      const { channels } = await meta();
      return channels.find((c) => c.id === channelId)?.name ?? null;
    },
  };
}

type NamedId = { id: string; name: string };

export async function suggest(guildId: string): Promise<SuggestOutcome> {
  await requireMember(guildId);
  try {
    const { questions, unanswerable } = await suggestQuestions({ guildId });
    return { questions: unanswerable ? [...questions, unanswerable] : questions };
  } catch {
    return { error: 'Could not think of questions just now. Try again in a moment.' };
  }
}
