// What happens when a member mentions the bot: ask the pipeline, then act by
// tier. Everything happens in the channel the question was asked in, the way
// a Discord conversation runs; no threads. Tier 1 answers. Tiers 2 and 3
// reply with the mod mention and record the question as pending, so a
// moderator's reply can become knowledge. Tier 4 says nothing in public and
// reports quietly to the mod channel.

import {
  HISTORY_LIMIT,
  classify,
  converse,
  forModel,
  hasOpenConversation,
  outageReply,
} from '@kalvard/core';
import type { Action, AnswerResult, Effects, HistoryTurn } from '@kalvard/core';
import { MODS } from '@kalvard/core/tokens';
import { serviceClient } from '@kalvard/core/supabase';
import type { Message, TextChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { GuildSettings } from './guild';
import { logEvent, mayPingMods } from './guild';
import { handleCommand } from './command';
import { findPending } from './knowledge';

/** Discord's own limit on a message. */
const MAX_MESSAGE = 2000;

export async function handleMention(message: Message, settings: GuildSettings): Promise<void> {
  const guild = message.guild;
  if (!guild || !message.channel.isTextBased()) return;

  const question = forModel(cleanMention(message), settings.limits);
  if (!question) {
    // A picture, a GIF, a sticker: Kalvard cannot read it, so it asks rather
    // than inventing what the member might have meant by it.
    const hasFile = message.attachments.size > 0 || message.stickers.size > 0;
    await message.reply(
      hasFile
        ? "I can't read images. Tell me in a line what you need and I'll help if I can."
        : 'Ask me something about the server and I will answer if I know.',
    );
    return;
  }

  // The same question, already waiting on a moderator: point at it rather
  // than waking them twice.
  const pending = await findPending(guild.id, question);
  if (pending?.link) {
    await message.reply(`Someone just asked this and the moderators have it: ${pending.link}`);
    return;
  }

  // A moderator asking for something to be done gets a plan and two buttons,
  // not an answer. A moderator asking a question falls straight through. And
  // a moderator in the middle of a conversation with Kalvard is answering it:
  // "no, fast forward role" after "do you want Fast Forward Test?" is a reply,
  // and reading it as an order is how a plan ends up giving a role to a
  // sentence.
  const conversationId = `${message.channelId}:${message.author.id}`;
  const midConversation = await hasOpenConversation(guild.id, conversationId);
  if (!midConversation && (await handleCommand(message, settings, question))) return;
  if (midConversation && (await handleCommand(message, settings, question, 'answering'))) return;

  const history = await recentHistory(message);
  const channel = message.channel;
  let result;
  try {
    result = await converse({
      guildId: guild.id,
      // One conversation per member per channel, so a follow-up continues it.
      conversationId,
      userId: message.author.id,
      askerName: message.author.displayName,
      message: question,
      channelId: message.channelId,
      history,
      asker: {
        nickname: message.member?.nickname ?? undefined,
        roles:
          message.member?.roles.cache.map((r) => r.name).filter((n) => n !== '@everyone') ?? [],
        isStaff: settings.modRoleId
          ? (message.member?.roles.cache.has(settings.modRoleId) ?? false)
          : false,
      },
      channel: {
        name: 'name' in channel && typeof channel.name === 'string' ? channel.name : undefined,
        category: 'parent' in channel && channel.parent ? channel.parent.name : undefined,
        topic: 'topic' in channel && typeof channel.topic === 'string' ? channel.topic : undefined,
      },
      effects: discordEffects(message, settings),
    });
  } catch (err) {
    // The model or the database, not the member. They are told in one line,
    // no moderator is woken for an outage, and the class is recorded so an
    // owner can tell an outage from a gap in the knowledge.
    const kind = classify(err);
    await logEvent(guild.id, 'tool_failed', { tool: 'answer', class: kind, question });
    console.error(`kalvard: answering failed (${kind}): ${String(err)}`);
    await message.reply(outageReply(kind)).catch(() => undefined);
    return;
  }

  switch (result.outcome) {
    // Nothing in the channel, one quiet line to the moderators.
    case 'flagged':
      await reportQuietly(message, result.category, result.note, settings);
      return;
    // It asked the member something, or did something it verified: both are
    // plain replies, and neither wakes a moderator.
    case 'ask':
    case 'assigned':
      await message.reply(result.text.slice(0, MAX_MESSAGE));
      return;
    case 'escalate':
      await postEscalation(message, result.text, result.summary, settings, question);
      return;
    case 'reply':
      if (!result.graded) {
        await message.reply(withMention(result.text, settings, true).slice(0, MAX_MESSAGE));
        return;
      }
      await postGraded(message, result.graded, settings, question);
      return;
  }
}

/** What the loop can do in Discord, and nothing more. */
function discordEffects(message: Message, settings: GuildSettings): Effects {
  const guild = message.guild!;
  return {
    async listRoles() {
      // Every role the server has. Which of them Kalvard may hand out is our
      // database's business, and the loop reads it from the settings.
      return guild.roles.cache
        .filter((r) => !r.managed && r.id !== guild.id)
        .map((r) => ({ id: r.id, name: r.name }));
    },
    async memberHasRole(userId, roleId) {
      const member = await guild.members.fetch(userId).catch(() => null);
      return member?.roles.cache.has(roleId) ?? false;
    },
    async memberInChannel(userId, channelId) {
      const member = await guild.members.fetch(userId).catch(() => null);
      const channel = guild.channels.cache.get(channelId);
      if (!member || !channel) return false;
      return channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false;
    },
    async assignRole(userId, roleId) {
      const member = await guild.members.fetch(userId).catch(() => null);
      const role = guild.roles.cache.get(roleId);
      const me = guild.members.me;
      if (!member || !role) return { ok: false, reason: 'unknown' };
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await reportPermissionOnce(guild, 'Manage Roles', settings);
        return { ok: false, reason: 'missing_permission' };
      }
      if (role.position >= me.roles.highest.position) {
        await reportPermissionOnce(guild, `a place above the ${role.name} role`, settings);
        return { ok: false, reason: 'role_too_high' };
      }
      try {
        await member.roles.add(role);
      } catch (err) {
        const kind = classify(err);
        await logEvent(guild.id, 'tool_failed', { tool: 'assign_role', roleId, class: kind });
        if (kind === 'permission') await reportPermissionOnce(guild, 'Manage Roles', settings);
        return { ok: false, reason: kind === 'permission' ? 'missing_permission' : 'unknown' };
      }
      await logEvent(guild.id, 'action', { action: { type: 'assign_role', roleId }, userId });
      return { ok: true };
    },
    async channelName(channelId) {
      const channel = guild.channels.cache.get(channelId);
      return channel && 'name' in channel ? channel.name : null;
    },
  };
}

/**
 * A permission Kalvard is missing is the owner's to fix, and telling them once
 * is help; telling them on every message is noise. The last report is found in
 * the events themselves, so this survives a restart.
 */
async function reportPermissionOnce(
  guild: Message['guild'],
  missing: string,
  settings: GuildSettings,
): Promise<void> {
  if (!guild) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await serviceClient()
    .from('bot_events')
    .select('id, payload')
    .eq('guild_id', guild.id)
    .eq('type', 'tool_failed')
    .gte('created_at', since)
    .limit(50);
  const told = (data ?? []).some(
    (row) => (row.payload as { missing?: string } | null)?.missing === missing,
  );
  await logEvent(guild.id, 'tool_failed', { tool: 'permissions', missing, reported: !told });
  if (told || !settings.modChannelId) return;
  const channel = guild.channels.cache.get(settings.modChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await (channel as TextChannel)
    .send(
      `I could not do something a member asked for because I am missing ${missing}. Nothing else is affected, and I will not repeat this today.`,
    )
    .catch(() => undefined);
}

/** The loop gave up: post it with the mention and leave the moderators the summary. */
async function postEscalation(
  message: Message,
  text: string,
  summary: string,
  settings: GuildSettings,
  question: string,
): Promise<void> {
  const guildId = message.guild!.id;
  const mayPing = settings.fallbackMode === 'ping_role' && (await mayPingMods(guildId));
  const posted = await message.reply(withMention(text, settings, mayPing).slice(0, MAX_MESSAGE));
  const { error } = await serviceClient().from('questions').insert({
    guild_id: guildId,
    asker_discord_id: message.author.id,
    asker_name: message.author.displayName,
    channel_id: message.channelId,
    message_id: message.id,
    bot_message_id: posted.id,
    question,
    bot_draft: summary,
    status: 'pending',
  });
  if (error) console.error(`kalvard: could not record the question: ${error.message}`);
  await logEvent(guildId, 'mod_pinged', {
    question,
    tier: 'escalate',
    summary,
    messageId: posted.id,
    quiet_queue: !mayPing,
  });
}

/** A graded reply, acted on by its tier. */
async function postGraded(
  message: Message,
  result: AnswerResult,
  settings: GuildSettings,
  question: string,
): Promise<void> {
  switch (result.tier) {
    case 'answer':
      await postAnswer(message, result, settings);
      return;
    case 'clarify':
      // Asking which one is meant is not an escalation: no mention, nothing pending.
      await message.reply(result.question.slice(0, MAX_MESSAGE));
      return;
    case 'partial':
    case 'none':
      await postFallback(message, result, settings, question);
      return;
    case 'flagged':
      await reportQuietly(message, result.category, result.note, settings);
      return;
    case 'ignore':
      // It was not addressed to Kalvard. Saying nothing is the whole behaviour.
      return;
    case 'sensitive':
      await message.reply(result.reply.slice(0, MAX_MESSAGE));
      await reportQuietly(message, 'sensitive', result.note, settings);
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
  if (error) console.error(`kalvard: could not record the question: ${error.message}`);

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
  category: string,
  note: string,
  settings: GuildSettings,
): Promise<void> {
  await logEvent(message.guild!.id, 'flagged', {
    category,
    note,
    question: message.content,
    askerName: message.author.displayName,
    channelId: message.channelId,
  });
  if (!settings.modChannelId) return;
  const channel = message.guild?.channels.cache.get(settings.modChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await (channel as TextChannel).send(
    `Flagged a message from ${message.author} in ${message.channel}: ${note} (${category})\n${message.url}`,
  );
}

/** The mod role mention, or a plain word when the role is not set or must not be pinged. */
export function withMention(text: string, settings: GuildSettings, mayPing: boolean): string {
  const mention = mayPing && settings.modRoleId ? `<@&${settings.modRoleId}>` : 'the moderators';
  return text.split(MODS).join(mention);
}

/**
 * The one action the model proposed, checked again here against the guild's
 * allowlist before anything happens. Kalvard never kicks, bans, times out or
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
    console.error(`kalvard: could not run the action: ${String(err)}`);
  }
}
