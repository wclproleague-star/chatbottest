// Puts the ticket panel up again, once, without changing what the server chose.
//
// The panel used to be a line of text with a button under it. It is a panel
// now, and a server that already had one should not have to run its setup
// again to see it: this reads the settings that are already saved, takes the
// old message down and posts the new one in the same channel with the same
// buttons. Nothing else is touched — the mode, the category, the roles and the
// ticket numbering are read, never written.
//
//   pnpm --filter @kalvard/bot repost:panel <guildId>

import process from 'node:process';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';
import type { TextChannel } from 'discord.js';
import { loadSupport } from '@kalvard/core';
import { panelMessage } from './panel';
import { botEnv } from './env';

const guildId = process.argv[2];
if (!guildId) {
  console.error('Which server? pnpm --filter @kalvard/bot repost:panel <guildId>');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(botEnv().token);
const guild = await client.guilds.fetch(guildId);

const support = await loadSupport(guildId);
if (support.mode !== 'tickets' || !support.setup?.buttonChannelId) {
  console.error('That server does not use tickets, or has no channel for the button.');
  await client.destroy();
  process.exit(1);
}

const found = await guild.channels.fetch(support.setup.buttonChannelId).catch(() => null);
if (!found || found.type !== ChannelType.GuildText) {
  console.error('The channel holding the button is gone.');
  await client.destroy();
  process.exit(1);
}
const channel = found as TextChannel;

// The same buttons the setup decided on, from what was saved.
const kinds = support.setup.ticketKinds ?? [];
const labels = kinds.length > 0 ? kinds : ['🎫 Open a ticket'];
const text = kinds.length > 0 ? 'Pick what it is about and a private ticket opens for you.' : '';

const posted = await channel.send(
  panelMessage({
    guildName: guild.name,
    text,
    // The id keeps the kind the setup chose; only the face is new.
    buttons: labels.map((label) => ({
      id: `ticket:open:${label.replace('🎫 ', '')}`,
      label,
    })),
  }),
);

// The old one goes, so the channel holds one panel rather than two.
const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
let removed = 0;
for (const message of recent?.values() ?? []) {
  if (message.id === posted.id) continue;
  if (message.author.id !== client.user?.id) continue;
  const opensTickets = message.components.some((row) =>
    JSON.stringify(row.toJSON()).includes('ticket:open'),
  );
  if (!opensTickets) continue;
  await message.delete().catch(() => undefined);
  removed++;
}

console.log(`Panel posted in #${channel.name}: ${posted.url}`);
console.log(removed > 0 ? `Took down ${removed} older one(s).` : 'There was nothing to replace.');
await client.destroy();
