// Puts the banner on the bot's own profile, once.
//
//   pnpm --filter @kalvard/bot set:banner
//
// Discord stores it on the application's user, so this is one PATCH and never
// part of the running worker: a bot that rewrites its own profile on every
// boot is a bot that spends its rate limit on nothing.

import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits } from 'discord.js';
import { botEnv } from './env';

const path = fileURLToPath(new URL('../../../assets/brand/banner-discord.png', import.meta.url));
const png = readFileSync(path);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(botEnv().token);
try {
  await client.rest.patch('/users/@me', {
    body: { banner: `data:image/png;base64,${png.toString('base64')}` },
  });
  console.log(`Banner set from ${path} (${Math.round(png.length / 1024)}kB).`);
} catch (err) {
  console.error(`Discord refused the banner: ${String(err)}`);
  process.exitCode = 1;
}
await client.destroy();
