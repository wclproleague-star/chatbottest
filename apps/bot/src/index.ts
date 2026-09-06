// Sentry's gateway client. One instance serves every guild, keyed by guild id;
// nothing about a guild is held in memory beyond the current message.
//
// It answers when it is mentioned in a channel the owner allowed, says so and
// mentions the moderators when it is not sure, and never kicks, bans, times
// out or deletes.

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { Message } from 'discord.js';
import { allowMessage, hasOpenConversation, sweepConversations } from '@sentrybot/core';
import { onModReply, onTick, watchDashboardApprovals } from './approve';
import { botEnv } from './env';
import {
  isClaimed,
  isOwner,
  loadSettings,
  markInstalled,
  markOrphaned,
  markUninstalled,
  syncMeta,
} from './guild';
import { handleMention } from './mention';
import { claim, sweepClaims } from './once';
import { onButton } from './playbook';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Reactions and messages the bot did not see arrive partial.
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

client.once(Events.ClientReady, async (ready) => {
  console.log(`sentry: online as ${ready.user.tag}, in ${ready.guilds.cache.size} guild(s)`);
  for (const guild of ready.guilds.cache.values()) {
    if (!(await isClaimed(guild.id))) {
      console.log(`sentry: ${guild.name} (${guild.id}) is not claimed on the web app yet`);
      continue;
    }
    await syncMeta(guild);
    await markInstalled(guild.id, guild.name);
    // The owner named the bot on the web app; that name is what members see
    // here, whatever the Discord application is called.
    const { botName } = await loadSettings(guild.id);
    if (botName && guild.members.me?.nickname !== botName) {
      await guild.members.me?.setNickname(botName).catch(() => undefined);
    }
  }
  watchDashboardApprovals(client);
  // Whatever expired while the worker was down, and whatever it has already
  // seen, are cleared on the way in rather than accumulating for ever.
  await sweepConversations().catch(() => undefined);
  await sweepClaims().catch(() => undefined);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`sentry: added to ${guild.name} (${guild.id})`);
  if (!(await isClaimed(guild.id))) return;
  await syncMeta(guild);
  await markInstalled(guild.id, guild.name);
  const settings = await loadSettings(guild.id);

  const nickname = settings.botName;
  if (nickname && guild.members.me?.nickname !== nickname) {
    await guild.members.me?.setNickname(nickname).catch(() => undefined);
  }
  if (settings.introChannelId && settings.introMessage) {
    const channel = guild.channels.cache.get(settings.introChannelId);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send(settings.introMessage).catch(() => undefined);
    }
  }
  await import('./guild').then((m) => m.logEvent(guild.id, 'install', { name: guild.name }));
});

client.on(Events.GuildDelete, async (guild) => {
  await markUninstalled(guild.id);
  await import('./guild').then((m) => m.logEvent(guild.id, 'uninstall', {}));
});

client.on(Events.MessageCreate, async (message: Message) => {
  try {
    if (message.author.bot) return;
    // A direct message is not a channel Sentry serves: it has no server to
    // answer about, no moderators to bring in and no owner who agreed to it.
    // One line, once, then silence. Sentry never opens a DM itself.
    if (!message.guild) {
      if (!(await claim(message.channelId, 'dm-pointer'))) return;
      await message
        .reply(
          'I only answer inside the server I was set up for. Ask me there and mention me, and I will help if I can.',
        )
        .catch(() => undefined);
      return;
    }
    if (!(await isClaimed(message.guild.id))) return;
    const settings = await loadSettings(message.guild.id);

    const allowed = settings.allowedChannelIds;
    if (allowed.length > 0 && !allowed.includes(message.channelId)) return;

    // A moderator replying to a question Sentry could not answer is answering
    // it, not asking a new one.
    if (message.reference?.messageId && (await onModReply(message, settings))) return;

    if (!client.user) return;
    // Sentry answers when it is named, when someone replies to something it
    // said, and when it is waiting on an answer to its own question. A reply
    // mentions it implicitly, which is why the mention alone is not the test.
    const named = message.content.includes(`<@${client.user.id}>`);
    const repliedTo = message.reference?.messageId;
    const answeringSentry = repliedTo
      ? (await message.channel.messages.fetch(repliedTo).catch(() => null))?.author.id ===
        client.user.id
      : false;
    const waiting = await hasOpenConversation(
      message.guild.id,
      `${message.channelId}:${message.author.id}`,
    );
    if (!named && !answeringSentry && !waiting) return;

    // Twenty messages in thirty seconds is not a conversation. Past the burst
    // the member is told once, then it goes quiet for them and for nobody else.
    // Discord redelivers on reconnect. One message, one answer.
    if (!(await claim(message.id, 'message', message.guild.id))) return;

    const allowance = allowMessage(`${message.guild.id}:${message.author.id}`, settings.limits);
    if (!allowance.allowed) {
      if (allowance.sayWhy) {
        await message
          .reply('That is a lot at once. Give me a minute and ask me again.')
          .catch(() => undefined);
      }
      return;
    }

    await handleMention(message, settings);
  } catch (err) {
    console.error(`sentry: message handler failed: ${String(err)}`);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    const guildId = reaction.message.guildId;
    if (!guildId || !(await isClaimed(guildId))) return;
    if (!(await claim(`${reaction.message.id}:${user.id}`, 'reaction', guildId))) return;
    await onTick(reaction, user, await loadSettings(guildId));
  } catch (err) {
    console.error(`sentry: reaction handler failed: ${String(err)}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton() || !interaction.guildId) return;
    if (!(await isClaimed(interaction.guildId))) return;
    await onButton(interaction);
  } catch (err) {
    console.error(`sentry: interaction handler failed: ${String(err)}`);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    if (!(await isClaimed(member.guild.id))) return;
    if (!(await isOwner(member.guild.id, member.id))) return;
    console.log(`sentry: the owner left ${member.guild.name}; marking it orphaned`);
    await markOrphaned(member.guild.id);
  } catch (err) {
    console.error(`sentry: member-remove handler failed: ${String(err)}`);
  }
});

client.on(Events.Error, (err) => console.error(`sentry: gateway error: ${err.message}`));

// discord.js queues rather than dropping when Discord asks it to slow down.
// This is only so a burst is visible afterwards rather than looking like a hang.
client.rest.on('rateLimited', (info) => {
  console.warn(
    `sentry: rate limited for ${info.timeToReset}ms on ${info.method} ${info.route}; queued, not dropped`,
  );
});

await client.login(botEnv().token);
