// What happens when a member mentions the bot: ask the pipeline, then act by
// tier. Everything happens in the channel the question was asked in, the way
// a Discord conversation runs; no threads. Tier 1 answers. Tiers 2 and 3
// reply with the mod mention and record the question as pending, so a
// moderator's reply can become knowledge. Tier 4 says nothing in public and
// reports quietly to the mod channel.

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

  // The same question, already waiting on a moderator: point at it rather
  // than waking them twice.
  const pending = await findPending(guild.id, question);
  if (pending?.link) {
    await message.reply(`Someone just asked this and the moderators have it: ${pending.link}`);
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
      await postFallback(message, result, settings, question);
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
 * Tiers 2 and 3: the reply in the channel, with the mod mention, and the
 * question stored pending. A moderator replies to that message and ticks it,
 * and their answer becomes knowledge.
 */
async function postFallback(
  message: Message,
  result: Extract<AnswerResult, { tier: 'partial' | 'none' }>,
  settings: GuildSettings,
  question: string,
): Promise<void> {
  const guildId = message.guild!.id;
  const mayPing = settings.fallbackMode === 'ping_role' && (await mayPingMods(guildId));
  const text = withMention(result.reply, settings, mayPing);

  const posted = await message.reply(text.slice(0, MAX_MESSAGE));
  // The tick a moderator presses to confirm the reading as written.
  if (result.tier === 'partial') await posted.react('✅').catch(() => undefined);

  const { error } = await serviceClient()
    .from('questions')
    .insert({
      guild_id: guildId,
      asker_discord_id: message.author.id,
      asker_name: message.author.displayName,
      channel_id: message.channelId,
      message_id: message.id,
      bot_message_id: posted.id,
      question,
      bot_draft: result.tier === 'partial' ? result.draft : result.found,
      top_chunk_ids: result.topChunkIds,
      status: 'pending',
    });
  if (error) console.error(`sentry: could not record the question: ${error.message}`);

  await logEvent(guildId, 'mod_pinged', {
    question,
    tier: result.tier,
    messageId: posted.id,
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
