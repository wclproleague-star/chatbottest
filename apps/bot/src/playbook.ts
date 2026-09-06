// What a playbook may do in Discord, and what happens when somebody clicks.
//
// Four actions beyond what the answer loop has: post a message, ask with
// buttons, react, pin. Each is still checked against the guild's allowlist by
// the engine before it gets here, so this file does the doing and nothing else.
//
// A click is an event like any other: it is claimed by id so a redelivery
// cannot count twice, the person who clicked is checked against the step's
// list, and anyone else is answered privately and changes nothing.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction, Guild, TextChannel } from 'discord.js';
import type { PlaybookEffects } from '@kalvard/core';
import { serviceClient } from '@kalvard/core/supabase';
import { logEvent } from './guild';
import { claim } from './once';

/** Who a pending question is for, kept until they answer or it expires. */
type Pending = { guildId: string; whoMayAnswer: string[]; question: string };
const pending = new Map<string, Pending>();

export function playbookEffects(guild: Guild): PlaybookEffects {
  const textChannel = (id: string): TextChannel | null => {
    const channel = guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : null;
  };

  return {
    async postMessage(channelId, text) {
      await textChannel(channelId)?.send(text.slice(0, 2000));
    },

    async askButtons({ channelId, question, options, whoMayAnswer }) {
      const channel = textChannel(channelId);
      if (!channel) return;
      const key = `pb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...options.slice(0, 5).map((option, i) =>
          new ButtonBuilder()
            .setCustomId(`${key}:${i}`)
            .setLabel(option.slice(0, 80))
            .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
      );
      const mentions = whoMayAnswer.map((id) => `<@${id}>`).join(' ');
      await channel.send({ content: `${mentions} ${question}`.trim(), components: [row] });
      pending.set(key, { guildId: guild.id, whoMayAnswer, question });
    },

    async addReaction(channelId, messageId, emoji) {
      const message = await textChannel(channelId)
        ?.messages.fetch(messageId)
        .catch(() => null);
      await message?.react(emoji).catch(() => undefined);
    },

    async pinMessage(channelId, messageId) {
      const message = await textChannel(channelId)
        ?.messages.fetch(messageId)
        .catch(() => null);
      await message?.pin().catch(() => undefined);
    },

    async channelId(name) {
      const wanted = name.replace(/^#/, '').toLowerCase();
      const found = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === wanted,
      );
      return found?.id ?? null;
    },
  };
}

/**
 * Somebody clicked. Discord gives three seconds, so the interaction is
 * answered first and the recording happens after. A click by somebody the step
 * did not name changes nothing and is said only to them.
 */
export async function onButton(interaction: ButtonInteraction): Promise<void> {
  const [key = '', index = '0'] = interaction.customId.split(':');
  const waiting = pending.get(key);
  if (!waiting) {
    await interaction.reply({
      content: 'That one has already been answered.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (waiting.whoMayAnswer.length > 0 && !waiting.whoMayAnswer.includes(interaction.user.id)) {
    await interaction.reply({
      content: 'That question is for the captains.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const label =
    interaction.component && 'label' in interaction.component
      ? (interaction.component.label ?? index)
      : index;

  await interaction.reply({ content: `Noted: ${label}`, flags: MessageFlags.Ephemeral });
  if (!(await claim(interaction.id, 'interaction', waiting.guildId))) return;

  pending.delete(key);
  await serviceClient()
    .from('playbook_runs')
    .insert({
      guild_id: waiting.guildId,
      mode: 'live',
      status: 'done',
      finished_at: new Date().toISOString(),
      summary: {
        answered: waiting.question,
        by: interaction.user.id,
        chose: label,
      },
    });
  await logEvent(waiting.guildId, 'action', {
    action: { type: 'button_answered', question: waiting.question },
    userId: interaction.user.id,
    chose: label,
  });
}
