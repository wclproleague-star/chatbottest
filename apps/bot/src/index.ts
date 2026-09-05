// Sentry's gateway client. One instance serves every guild, keyed by guild id;
// nothing about a guild is held in memory beyond the current message.
//
// It answers when it is mentioned in a channel the owner allowed, says so and
// mentions the moderators when it is not sure, and never kicks, bans, times
// out or deletes.

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { Message } from 'discord.js';
import { onModReply, onTick, watchDashboardApprovals } from './approve';
import { botEnv } from './env';
import { isClaimed, loadSettings, markInstalled, markUninstalled, syncMeta } from './guild';
import { handleMention } from './mention';

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
    if (message.author.bot || !message.guild) return;
    if (!(await isClaimed(message.guild.id))) return;
    const settings = await loadSettings(message.guild.id);

    const allowed = settings.allowedChannelIds;
    if (allowed.length > 0 && !allowed.includes(message.channelId)) return;

    // A moderator replying to a question Sentry could not answer is answering
    // it, not asking a new one.
    if (message.reference?.messageId && (await onModReply(message, settings))) return;

    // Only a real mention of the bot, written in the message. Replying to the
    // bot mentions it implicitly, and that is not a question.
    if (!client.user) return;
    if (!message.content.includes(`<@${client.user.id}>`)) return;
    await handleMention(message, settings);
  } catch (err) {
    console.error(`sentry: message handler failed: ${String(err)}`);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    const guildId = reaction.message.guildId;
    if (!guildId || !(await isClaimed(guildId))) return;
    await onTick(reaction, user, await loadSettings(guildId));
  } catch (err) {
    console.error(`sentry: reaction handler failed: ${String(err)}`);
  }
});

client.on(Events.Error, (err) => console.error(`sentry: gateway error: ${err.message}`));

await client.login(botEnv().token);
