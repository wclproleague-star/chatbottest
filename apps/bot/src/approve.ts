// The approval loop. In a thread the bot opened, a moderator either ticks the
// draft the bot posted, or writes the answer themselves and ticks that. Either
// way the answer is stored, filed as knowledge, given to the member who asked,
// and the thread is archived. Answers approved on the dashboard arrive here
// too, by polling the events table.

import { serviceClient } from '@sentrybot/core/supabase';
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { ChannelType } from 'discord.js';
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
  thread_id: string | null;
};

async function pendingForThread(
  guildId: string,
  threadId: string,
): Promise<PendingQuestion | null> {
  const { data } = await serviceClient()
    .from('questions')
    .select('id, question, asker_discord_id, bot_draft, thread_id')
    .eq('guild_id', guildId)
    .eq('thread_id', threadId)
    .eq('status', 'pending')
    .maybeSingle();
  return data ?? null;
}

/** A moderator wrote in one of the bot's threads: offer them the tick. */
export async function onThreadMessage(message: Message, settings: GuildSettings): Promise<void> {
  if (!settings.modRoleId) return;
  if (!message.member?.roles.cache.has(settings.modRoleId)) return;
  const pending = await pendingForThread(message.guild!.id, message.channelId);
  if (!pending) return;
  await message.react(TICK);
  await message.react(UNSURE);
}

/**
 * A tick from a moderator. On the bot's own message it confirms the draft; on
 * a moderator's message it takes their text as the correction.
 */
export async function onTick(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  settings: GuildSettings,
): Promise<void> {
  if (reaction.emoji.name !== TICK || user.bot) return;
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const guild = message.guild;
  if (!guild || message.channel.type !== ChannelType.PublicThread) return;
  if (!settings.modRoleId) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(settings.modRoleId)) return;

  const pending = await pendingForThread(guild.id, message.channelId);
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
  await message.channel.send(`${asker}${answer}\n\nGot it. Next time I'll know.`);
  await logEvent(guild.id, 'approved', {
    questionId: pending.id,
    answered_via: 'discord',
    answeredBy: user.id,
  });
  await message.channel.setArchived(true).catch(() => undefined);
}

/**
 * Answers approved on the dashboard: the web app writes the event, the bot
 * posts it into the thread the question was asked in.
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
          .select('thread_id, answer, asker_discord_id')
          .eq('id', payload.questionId)
          .maybeSingle();
        if (!question?.thread_id || !question.answer) continue;
        const thread = await client.channels.fetch(question.thread_id).catch(() => null);
        if (!thread?.isTextBased() || !('send' in thread)) continue;
        const asker = question.asker_discord_id ? `<@${question.asker_discord_id}> ` : '';
        await thread.send(`${asker}${question.answer}\n\nGot it. Next time I'll know.`);
      }
    })();
  }, POLL_MS);
}
