// Tickets: a button opens a private room, a button closes it.
//
// This only runs when the server chose tickets as where members get help. A
// press on "Open a ticket" (or on one of the kinds the owner offered) makes
// #ticket-N under the tickets category, visible to the member, the role the
// owner named for when a human is needed, and Kalvard; Kalvard greets them
// there and answers as it does anywhere. Close archives the room: nobody can
// write in it, and nothing is deleted. Every press is claimed by id, so a
// double delivery opens one room.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { ButtonInteraction, Guild, TextChannel } from 'discord.js';
import { loadSupport, nextTicketNumber } from '@kalvard/core';
import { logEvent } from './guild';
import { claim } from './once';

/** Handles a ticket button. Returns whether the press was one. */
export async function onTicketButton(interaction: ButtonInteraction): Promise<boolean> {
  const [prefix = '', verb = '', kind = ''] = interaction.customId.split(':');
  if (prefix !== 'ticket' || !interaction.guild) return false;
  const guild = interaction.guild;

  const support = await loadSupport(guild.id);
  if (support.mode !== 'tickets' || !support.setup) {
    await interaction.reply({
      content: 'Tickets are not switched on here any more. Ask in the help channel instead.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (verb === 'close') {
    await interaction.deferReply();
    if (!(await claim(interaction.id, 'ticket-close', guild.id))) return true;
    const channel = interaction.channel;
    if (channel?.type === ChannelType.GuildText) {
      await archive(guild, channel as TextChannel);
      await interaction.editReply('Closed. This room is kept, read-only.').catch(() => undefined);
      await logEvent(guild.id, 'action', {
        action: { type: 'ticket_closed' },
        channelId: channel.id,
        userId: interaction.user.id,
      });
    }
    return true;
  }

  if (verb !== 'open') return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await claim(interaction.id, 'ticket-open', guild.id))) return true;

  const number = await nextTicketNumber(guild.id);
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow },
    ...(support.setup.humanRoleId ? [{ id: support.setup.humanRoleId, allow }] : []),
    ...(guild.members.me ? [{ id: guild.members.me.id, allow }] : []),
  ];
  const room = await guild.channels.create({
    name: `ticket-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: support.setup.categoryId,
    permissionOverwrites: overwrites,
    topic: `Ticket ${number}${kind ? `, ${kind}` : ''}, opened by ${interaction.user.id}`,
  });

  const close = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary),
  );
  await room.send({
    content: [
      `<@${interaction.user.id}> this room is yours${kind ? ` — ${kind}` : ''}. Say what you need and I will help if I know; if it takes a person, I bring in ${
        support.setup.humanRoleId ? `<@&${support.setup.humanRoleId}>` : 'the staff'
      }.`,
      'Close it with the button when you are done.',
    ].join('\n'),
    components: [close],
    allowedMentions: { users: [interaction.user.id], roles: [] },
  });
  await interaction.editReply(`Your ticket is open: <#${room.id}>`).catch(() => undefined);
  await logEvent(guild.id, 'action', {
    action: { type: 'ticket_opened' },
    channelId: room.id,
    userId: interaction.user.id,
    kind: kind || null,
    number,
  });
  return true;
}

/** Locks the room for everyone but the human role and Kalvard; deletes nothing. */
async function archive(guild: Guild, channel: TextChannel): Promise<void> {
  await channel.permissionOverwrites
    .edit(guild.roles.everyone.id, { SendMessages: false, ViewChannel: false })
    .catch(() => undefined);
  for (const [id, overwrite] of channel.permissionOverwrites.cache) {
    if (id === guild.roles.everyone.id || id === guild.members.me?.id) continue;
    await channel.permissionOverwrites
      .edit(id, {
        SendMessages: false,
        ViewChannel: overwrite.allow.has(PermissionFlagsBits.ViewChannel),
      })
      .catch(() => undefined);
  }
  if (!channel.name.startsWith('closed-')) {
    await channel.setName(`closed-${channel.name}`.slice(0, 90)).catch(() => undefined);
  }
}
