// Command mode in Discord: a moderator says what they want, reads the plan,
// and presses Confirm or Cancel.
//
// The plan is posted as sentences with the real names in them, item by item
// once it touches more than three things, and nothing happens until somebody
// presses the button. Only the person who asked may confirm their own plan:
// a plan somebody else can approve is a plan somebody else can be blamed for.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { ButtonInteraction, Client, Guild, Message, TextChannel } from 'discord.js';
import { ITEMISE_ABOVE, cancelCommand, planCommand, recordCommand, runPlan } from '@kalvard/core';
import type { CommandEffects, GuildShape, PlannedStep } from '@kalvard/core';
import { serviceClient } from '@kalvard/core/supabase';
import type { GuildSettings } from './guild';
import { logEvent } from './guild';
import { claim } from './once';

/** A plan posted and waiting on its author. */
type Waiting = { guildId: string; askedBy: string; commandId: string; steps: PlannedStep[] };
const waiting = new Map<string, Waiting>();

/**
 * Tries the message as a command. Returns true when it was one, so the caller
 * stops: a plan and an answer to the same message would be two replies.
 */
export async function handleCommand(
  message: Message,
  settings: GuildSettings,
  request: string,
): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;
  const isStaff = settings.modRoleId
    ? (message.member?.roles.cache.has(settings.modRoleId) ?? false)
    : false;
  const isOwner = guild.ownerId === message.author.id;
  if (!isStaff && !isOwner) return false;

  const shape = await shapeOf(guild);
  const by = { id: message.author.id, name: message.author.displayName, isStaff, isOwner };
  const plan = await planCommand({ guildId: guild.id, request, by, shape });

  // Not a request to change anything, so it was a question or a greeting: the
  // answer loop has it, and nothing is written down. A moderator is a member
  // who can also give orders, not a member who has stopped being one.
  if (plan.kind === 'not_a_command') return false;

  const commandId = await recordCommand({ guildId: guild.id, by, request, plan });
  await logEvent(guild.id, 'action', {
    action: { type: 'command_planned' },
    userId: by.id,
    request,
    kind: plan.kind,
  });

  if (plan.kind === 'refused') {
    await message.reply(plan.because);
    return true;
  }
  if (plan.kind === 'question') {
    await message.reply(`${plan.because} ${plan.question}`);
    return true;
  }

  const key = `cmd-${commandId}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${key}:yes`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${key}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  // Item by item once it is more than a couple of things.
  const body =
    plan.steps.length > ITEMISE_ABOVE
      ? plan.steps.map((step, i) => `${i + 1}. ${step.sentence}`).join(String.fromCharCode(10))
      : plan.steps.map((step) => `- ${step.sentence}`).join(String.fromCharCode(10));
  await message.reply({
    content: `Here is what I would do. Nothing has happened yet.\n${body}`,
    components: [row],
  });
  waiting.set(key, { guildId: guild.id, askedBy: by.id, commandId, steps: plan.steps });
  return true;
}

/** Confirm or Cancel. Only the person who asked may answer their own plan. */
export async function onCommandButton(interaction: ButtonInteraction): Promise<boolean> {
  const [key = '', answer = ''] = interaction.customId.split(':');
  if (!key.startsWith('cmd-')) return false;
  const plan = waiting.get(key);
  if (!plan) {
    await interaction.reply({
      content: 'That plan has already been answered.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (interaction.user.id !== plan.askedBy) {
    await interaction.reply({
      content: 'Only the person who asked can confirm this one.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (answer === 'no') {
    waiting.delete(key);
    await cancelCommand(plan.commandId);
    await interaction.reply('Cancelled, nothing was changed. What would you like different?');
    return true;
  }

  // Discord gives three seconds; the work happens after the acknowledgement.
  await interaction.deferReply();
  if (!(await claim(interaction.id, 'command', plan.guildId))) return true;
  waiting.delete(key);

  const guild = interaction.guild;
  if (!guild) return true;
  const done = await runPlan({
    guildId: guild.id,
    commandId: plan.commandId,
    plan: plan.steps,
    shape: await shapeOf(guild),
    effects: commandEffects(guild),
  });

  const report = done
    .map(
      (step) => `${step.ok ? '·' : 'stopped:'} ${step.detail}${step.link ? ` ${step.link}` : ''}`,
    )
    .join(String.fromCharCode(10));
  await interaction.editReply(report || 'Nothing to do.');
  await logEvent(guild.id, 'action', {
    action: { type: 'command_ran' },
    userId: interaction.user.id,
    steps: done.length,
    ok: done.every((d) => d.ok),
  });
  return true;
}

/**
 * Commands confirmed in the dashboard. The web can plan but cannot reach
 * Discord, so it writes the confirmation down and this picks it up: one
 * process holds the connection, and it is this one.
 */
export function watchDashboardCommands(client: Client): NodeJS.Timeout {
  let since = new Date().toISOString();
  return setInterval(() => {
    void (async () => {
      const { data } = await serviceClient()
        .from('bot_events')
        .select('id, guild_id, payload, created_at')
        .eq('type', 'action')
        .gt('created_at', since)
        .order('created_at');
      if (!data || data.length === 0) return;
      since = data[data.length - 1]!.created_at;

      for (const event of data) {
        const payload = event.payload as { commandId?: string; confirmed?: boolean };
        if (!payload.confirmed || !payload.commandId) continue;
        if (!(await claim(payload.commandId, 'command-web', event.guild_id))) continue;

        const { data: row } = await serviceClient()
          .from('commands')
          .select('id, plan, status')
          .eq('id', payload.commandId)
          .maybeSingle();
        if (!row || row.status !== 'planned') continue;
        const guild = client.guilds.cache.get(event.guild_id);
        if (!guild) continue;

        const done = await runPlan({
          guildId: guild.id,
          commandId: row.id,
          plan: row.plan as unknown as PlannedStep[],
          shape: await shapeOf(guild),
          effects: commandEffects(guild),
        });
        await logEvent(guild.id, 'action', {
          action: { type: 'command_ran' },
          from: 'dashboard',
          steps: done.length,
          ok: done.every((d) => d.ok),
        });
      }
    })();
  }, 10_000);
}

/** What the guild has, as the planner needs to see it. */
export async function shapeOf(guild: Guild): Promise<GuildShape> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('allowed_actions, mod_role_id')
    .eq('guild_id', guild.id)
    .maybeSingle();
  const modRole = data?.mod_role_id ? guild.roles.cache.get(data.mod_role_id) : undefined;
  return {
    channels: guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name })),
    categories: guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name })),
    roles: guild.roles.cache
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name })),
    allowedActions: data?.allowed_actions ?? [],
    modRole: modRole ? { id: modRole.id, name: modRole.name } : undefined,
  };
}

/** The doing half. Nothing here is reachable without a Confirm. */
export function commandEffects(guild: Guild): CommandEffects {
  const text = (id: string): TextChannel | null => {
    const channel = guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : null;
  };

  return {
    async createChannel({ name, category, privateForRoleIds }) {
      const parent = category
        ? guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildCategory &&
              c.name.toLowerCase() === category.toLowerCase(),
          )
        : undefined;
      // A private channel is created private. Making it and then locking it
      // would leave a moment where the whole server could read it.
      const overwrites = privateForRoleIds?.length
        ? [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            ...privateForRoleIds.map((roleId) => ({
              id: roleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            })),
            // Kalvard keeps its own way in, or it cannot post there afterwards.
            ...(guild.members.me
              ? [
                  {
                    id: guild.members.me.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  },
                ]
              : []),
          ]
        : undefined;
      const created = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parent?.id,
        permissionOverwrites: overwrites,
      });
      return { id: created.id, url: created.url };
    },

    async allowRoles({ channelId, roleIds }) {
      const channel = text(channelId);
      if (!channel) throw new Error('That channel is gone.');
      // Named roles get in; everyone else keeps whatever they had.
      for (const roleId of roleIds) {
        await channel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }
    },

    async setPrivate({ channelId, roleIds }) {
      const channel = text(channelId);
      if (!channel) throw new Error('That channel is gone.');
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      for (const roleId of roleIds) {
        await channel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }
      // Kalvard keeps its own way in, or it cannot post there afterwards.
      if (guild.members.me) {
        await channel.permissionOverwrites.edit(guild.members.me.id, {
          ViewChannel: true,
          SendMessages: true,
        });
      }
    },

    async archiveChannel({ channelId }) {
      const channel = text(channelId);
      if (!channel) throw new Error('That channel is gone.');
      // Archived, not deleted: it stays, and nobody can write in it.
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    },

    async postMessage({ channelId, text: body }) {
      const channel = text(channelId);
      if (!channel) throw new Error('That channel is gone.');
      const posted = await channel.send(body.slice(0, 2000));
      return { url: posted.url };
    },

    async pinMessage({ channelId, messageId }) {
      const message = await text(channelId)
        ?.messages.fetch(messageId)
        .catch(() => null);
      await message?.pin();
    },

    async assignRole({ userId, roleId }) {
      const member = await guild.members.fetch(userId).catch(() => null);
      const role = guild.roles.cache.get(roleId);
      const me = guild.members.me;
      if (!member || !role) throw new Error('That member or role is gone.');
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('I do not have permission to manage roles here.');
      }
      await member.roles.add(role);
    },
  };
}
