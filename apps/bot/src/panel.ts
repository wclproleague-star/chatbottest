// The one message a member sees before they ever talk to Kalvard.
//
// A line of grey text with a button under it reads like a form. The panel a
// member opens a ticket from is the product's first impression, so it is built
// the way the rest of Kalvard is: the mark, the server's own name, one
// sentence, and the amber rule down the side that means the vard is watching.
// Nothing else — no icons standing in for ideas, no second colour.

import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

/** Waiting amber, the state that means somebody is keeping watch. */
export const AMBER = 0xd9a21b;

/** The mark, sent with the message so the embed can show it. */
const MARK = fileURLToPath(new URL('../../../assets/brand/avatar-512.png', import.meta.url));
const MARK_NAME = 'kalvard.png';

/**
 * The ticket panel's own words.
 *
 * A member reading this has never met Kalvard, so it introduces itself, says
 * what a ticket is for and what happens in one, and stops. Discord is a place
 * with faces in it: the lines carry an emoji each because a wall of grey text
 * in a support channel is read by nobody.
 */
export const TICKET_PANEL = {
  title: '👋 Hey, I am Kalvard',
  text: 'Ask me anything about the server — the rules, the schedule, check-in, your roles. Press the button and a room opens just for you.',
  /**
   * Three short columns rather than three stacked lines: Discord lays inline
   * fields out side by side, which reads as a panel instead of a paragraph
   * somebody bolded a few words in.
   */
  points: [
    { name: '🎫 Private', value: 'A room only you can see' },
    { name: '🛡️ Staff on call', value: 'They are in it with me' },
    { name: '⚡ Straight answer', value: 'Or I wake a human' },
  ],
};

/** What a channel is sent to put the panel up. */
export type Panel = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files: AttachmentBuilder[];
};

/**
 * The panel: the server's name over one sentence, with its buttons under it.
 *
 * The mark is attached rather than linked, so it keeps working whether or not
 * the bot's avatar is reachable, and nothing is fetched from outside Discord.
 */
export function panelMessage(input: {
  guildName: string;
  text: string;
  title?: string;
  footer?: string;
  buttons: { id: string; label: string }[];
}): Panel {
  // A ticket panel is the one a member meets first, and it says so properly
  // whoever asked for it: the plan's one line becomes the panel's own words.
  const ticket = input.buttons.some((b) => b.id.startsWith('ticket:'));
  const title = input.title ?? (ticket ? TICKET_PANEL.title : undefined);
  const body =
    ticket && input.text.length < TICKET_PANEL.text.length ? TICKET_PANEL.text : input.text;
  const files = existsSync(MARK) ? [new AttachmentBuilder(MARK, { name: MARK_NAME })] : [];

  const embed = new EmbedBuilder().setColor(AMBER).setDescription(body.slice(0, 4000));
  if (title) embed.setTitle(title);
  // The mark sits at the panel's own size, on the right, rather than shrunk
  // into the line above the title where it read as a favicon.
  if (files.length > 0) embed.setThumbnail(`attachment://${MARK_NAME}`);
  if (ticket) embed.addFields(TICKET_PANEL.points.map((p) => ({ ...p, inline: true })));
  embed.setFooter({ text: input.footer ?? `${input.guildName} · Kalvard keeps watch here.` });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const buttons = input.buttons.slice(0, 5);
  if (buttons.length > 0) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buttons.map((button, i) =>
          new ButtonBuilder()
            .setCustomId(button.id.slice(0, 100))
            .setLabel(button.label.slice(0, 80))
            .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
      ),
    );
  }
  return { embeds: [embed], components: rows, files };
}
