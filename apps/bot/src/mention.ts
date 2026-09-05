// What happens when a member mentions the bot: ask the pipeline, then act by
// tier. Tier 1 answers in the channel. Tiers 2 and 3 open a thread, post the
// reply with the mod mention, and record the question as pending. Tier 4 says
// nothing in public and reports quietly to the mod channel.

import { HISTORY_LIMIT, answer } from '@sentrybot/core';
import type { Action, AnswerResult, HistoryTurn } from '@sentrybot/core';
import { MODS } from '@sentrybot/core/tokens';
import { serviceClient } from '@sentrybot/core/supabase';
import type { Message, TextChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { GuildSettings } from './guild';
import { logEvent, mayPingMods } from './guild';
import { findPending } from './knowledge';

/** Discord's own limit on a message. */
const MAX_MESSAGE = 2000;

export async function handleMention(message: Message, settings: GuildSettings): Promise<void> {
  const guild = message.guild;
  if (!guild || !message.channel.isTextBased()) return;

  const question = cleanMention(message);
  if (!question) {
    await message.reply('Ask me something about the server and I will answer if I know.');
    return;
  }

  // The same question, already waiting on a moderator: point at that thread
  // rather than waking them twice.
  const pending = await findPending(guild.id, question);
  if (pending?.threadId) {
    await message.reply(
      `Someone already asked this and the moderators have it: ${threadLink(guild.id, pending.threadId)}`,
    );
    return;
  }

  const history = await recentHistory(message);
  const result = await answer({
    guildId: guild.id,
    question,
    askerName: message.author.displayName,
    channelId: message.channelId,
    history,
  });

  switch (result.tier) {
    case 'answer':
      await postAnswer(message, result, settings);
      return;
    case 'partial':
    case 'none':
      await openFallbackThread(message, result, settings, question);
      return;
    case 'flagged':
      await reportQuietly(message, result, settings);
      return;
  }
}

/** The message without the bot's own mention, which is not part of the question. */
function cleanMention(message: Message): string {
  const clientId = message.client.user?.id;
  return message.content
    .replace(new RegExp(`<@!?${clientId}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The last few messages of the channel, oldest first, as conversation context. */
async function recentHistory(message: Message): Promise<HistoryTurn[]> {
  try {
    const fetched = await message.channel.messages.fetch({
      limit: HISTORY_LIMIT,
      before: message.id,
    });
    return [...fetched.values()]
      .reverse()
      .filter((m) => m.content.trim() && !m.system)
      .map((m) => ({
        role: m.author.id === message.client.user?.id ? ('model' as const) : ('user' as const),
        text: m.content.slice(0, 500),
      }));
  } catch {
    return [];
  }
}

async function postAnswer(
  message: Message,
  result: Extract<AnswerResult, { tier: 'answer' }>,
  settings: GuildSettings,
): Promise<void> {
  const text = withMention(result.answer, settings, true);
  await message.reply(text.slice(0, MAX_MESSAGE));
  if (result.action) await runAction(message, result.action, settings);
}

/**
 * Tiers 2 and 3: a thread on the member's message, the reply inside it with
 * the mod mention, and the question stored pending so a moderator's tick or
 * correction can become knowledge.
 */
async function openFallbackThread(
  message: Message,
  result: Extract<AnswerResult, { tier: 'partial' | 'none' }>,
  settings: GuildSettings,
  question: string,
): Promise<void> {
  const guildId = message.guild!.id;
  const mayPing = settings.fallbackMode === 'ping_role' && (await mayPingMods(guildId));
  const text = withMention(result.reply, settings, mayPing);

  let threadId: string | null = null;
  let postedId: string | null = null;
  try {
    const thread = await message.startThread({
      name: question.slice(0, 90) || 'A question for the moderators',
      autoArchiveDuration: 1440,
    });
    const posted = await thread.send(text.slice(0, MAX_MESSAGE));
    // The tick a moderator presses to confirm the draft as written.
    if (result.tier === 'partial') await posted.react('✅');
    threadId = thread.id;
    postedId = posted.id;
  } catch (err) {
    // No permission to open threads: answer in the channel instead, so the
    // member is never left without a reply.
    console.error(`sentry: could not open a thread: ${String(err)}`);
    await message.reply(text.slice(0, MAX_MESSAGE));
  }

  const { error } = await serviceClient()
    .from('questions')
    .insert({
      guild_id: guildId,
      asker_discord_id: message.author.id,
      asker_name: message.author.displayName,
      channel_id: message.channelId,
      message_id: message.id,
      thread_id: threadId,
      question,
      bot_draft: result.tier === 'partial' ? result.draft : result.found,
      top_chunk_ids: result.topChunkIds,
      status: 'pending',
    });
  if (error) console.error(`sentry: could not record the question: ${error.message}`);

  await logEvent(guildId, 'mod_pinged', {
    question,
    tier: result.tier,
    threadId,
    messageId: postedId,
    quiet_queue: !mayPing,
  });
}

/** Tier 4: nothing in public, one quiet line to the moderators. */
async function reportQuietly(
  message: Message,
  result: Extract<AnswerResult, { tier: 'flagged' }>,
  settings: GuildSettings,
): Promise<void> {
  if (!settings.modChannelId) return;
  const channel = message.guild?.channels.cache.get(settings.modChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await (channel as TextChannel).send(
    `Flagged a message from ${message.author} in ${message.channel}: ${result.note} (${result.category})\n${message.url}`,
  );
}

/** The mod role mention, or a plain word when the role is not set or must not be pinged. */
export function withMention(text: string, settings: GuildSettings, mayPing: boolean): string {
  const mention = mayPing && settings.modRoleId ? `<@&${settings.modRoleId}>` : 'the moderators';
  return text.split(MODS).join(mention);
}

function threadLink(guildId: string, threadId: string): string {
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

/**
 * The one action the model proposed, checked again here against the guild's
 * allowlist before anything happens. Sentry never kicks, bans, times out or
 * deletes; those are not actions it can take.
 */
async function runAction(message: Message, action: Action, settings: GuildSettings): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  try {
    switch (action.type) {
      case 'point_to_channel': {
        const channel = guild.channels.cache.get(action.channelId);
        if (channel) await message.reply(`It is in ${channel}.`);
        break;
      }
      case 'assign_role': {
        if (!settings.selfServeRoleIds.includes(action.roleId)) return;
        const me = guild.members.me;
        const role = guild.roles.cache.get(action.roleId);
        if (!role || !me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
        if (role.position >= (me.roles.highest.position ?? 0)) return;
        await message.member?.roles.add(role);
        await message.reply(`Given you ${role.name}.`);
        break;
      }
      case 'open_thread': {
        await message.startThread({ name: action.title.slice(0, 90), autoArchiveDuration: 1440 });
        break;
      }
      case 'escalate': {
        const mayPing = settings.fallbackMode === 'ping_role' && (await mayPingMods(guild.id));
        await message.reply(withMention(`${MODS}, this one needs you.`, settings, mayPing));
        break;
      }
    }
    await logEvent(guild.id, 'action', { action, messageId: message.id });
  } catch (err) {
    console.error(`sentry: could not run the action: ${String(err)}`);
  }
}
