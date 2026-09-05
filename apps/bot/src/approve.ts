// The approval loop, in the channel. When Sentry is not sure it says so where
// the question was asked and mentions the moderators. A moderator replies to
// that message with the real answer; Sentry offers them a tick, and on the
// tick the answer is stored, filed as knowledge and given to the member who
// asked. Answers approved on the dashboard arrive here too, by polling.

import { serviceClient } from '@sentrybot/core/supabase';
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import type { GuildSettings } from './guild';
import { logEvent } from './guild';
import { recordAnswer } from './knowledge';

const TICK = '✅';
const UNSURE = '❓';
/** How often the dashboard's approvals are picked up. */
const POLL_MS = 15_000;

type PendingQuestion = {
  id: string;
  question: string;
  asker_discord_id: string | null;
  bot_draft: string | null;
  channel_id: string | null;
  message_id: string | null;
  bot_message_id: string | null;
};

const COLUMNS = 'id, question, asker_discord_id, bot_draft, channel_id, message_id, bot_message_id';

/** The pending question one of these message ids belongs to, if any. */
async function pendingForMessages(
  guildId: string,
  ids: (string | null | undefined)[],
): Promise<PendingQuestion | null> {
  const known = ids.filter((id): id is string => Boolean(id));
  if (known.length === 0) return null;
  const { data } = await serviceClient()
    .from('questions')
    .select(COLUMNS)
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .or(known.map((id) => `bot_message_id.eq.${id},message_id.eq.${id}`).join(','))
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * A moderator replied to a question Sentry could not answer: offer them the
 * tick, so one press turns their reply into knowledge. Returns whether this
 * message was such a reply, which means it is an answer and not a question.
 */
export async function onModReply(message: Message, settings: GuildSettings): Promise<boolean> {
  if (!settings.modRoleId || !message.guild) return false;
  if (!message.member?.roles.cache.has(settings.modRoleId)) return false;
  const repliedTo = message.reference?.messageId;
  if (!repliedTo) return false;
  const pending = await pendingForMessages(message.guild.id, [repliedTo]);
  if (!pending) return false;
  await message.react(TICK);
  await message.react(UNSURE);
  return true;
}

/**
 * A tick from a moderator. On Sentry's own message it confirms the draft it
 * offered; on a moderator's reply it takes their text as the answer.
 */
export async function onTick(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  settings: GuildSettings,
): Promise<void> {
  if (reaction.emoji.name !== TICK || user.bot) return;
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const guild = message.guild;
  if (!guild || !settings.modRoleId) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(settings.modRoleId)) return;

  // Either the tick is on Sentry's own message, or on a reply to it.
  const pending = await pendingForMessages(guild.id, [
    message.id,
    message.reference?.messageId ?? null,
  ]);
  if (!pending) return;

  const fromBot = message.author?.id === message.client.user?.id;
  const answer = (fromBot ? pending.bot_draft : message.content)?.trim();
  if (!answer) return;

  await recordAnswer({
    guildId: guild.id,
    questionId: pending.id,
    question: pending.question,
    answer,
    answeredBy: user.id,
  });

  const asker = pending.asker_discord_id ? `<@${pending.asker_discord_id}> ` : '';
  if (message.channel.isSendable()) {
    await message.channel.send(`${asker}${answer}\n\nGot it. Next time I'll know.`);
  }
  await logEvent(guild.id, 'approved', {
    questionId: pending.id,
    answered_via: 'discord',
    answeredBy: user.id,
  });
}

/**
 * Answers approved on the dashboard: the web app writes the event, the bot
 * posts it in the channel the question was asked in.
 */
export function watchDashboardApprovals(client: Client): NodeJS.Timeout {
  let since = new Date().toISOString();
  return setInterval(() => {
    void (async () => {
      const { data, error } = await serviceClient()
        .from('bot_events')
        .select('id, guild_id, payload, created_at')
        .eq('type', 'approved')
        .gt('created_at', since)
        .order('created_at');
      if (error || !data || data.length === 0) return;
      since = data[data.length - 1]!.created_at;

      for (const event of data) {
        const payload = event.payload as { answered_via?: string; questionId?: string };
        if (payload.answered_via !== 'dashboard' || !payload.questionId) continue;
        const { data: question } = await serviceClient()
          .from('questions')
          .select('channel_id, answer, asker_discord_id')
          .eq('id', payload.questionId)
          .maybeSingle();
        if (!question?.channel_id || !question.answer) continue;
        const channel = await client.channels.fetch(question.channel_id).catch(() => null);
        if (!channel?.isTextBased() || !channel.isSendable()) continue;
        const asker = question.asker_discord_id ? `<@${question.asker_discord_id}> ` : '';
        await channel.send(`${asker}${question.answer}\n\nGot it. Next time I'll know.`);
      }
    })();
  }, POLL_MS);
}
