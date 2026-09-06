// Deletes the data of guilds that removed the bot more than the retention
// window ago. Removal is not deletion: an owner who reinstalls within the
// month finds their knowledge where they left it. After that the guild row
// goes, and everything keyed to it goes with it, because every table cascades
// on guild_id.
//
//   pnpm --filter @kalvard/core purge          # says what it would delete
//   pnpm --filter @kalvard/core purge -- --run # deletes it

import process from 'node:process';
import { fileURLToPath } from 'node:url';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present.
  }
}

const { serviceClient } = await import('./supabase');
const { RETENTION_DAYS } = await import('./times');

const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
const db = serviceClient();

const { data, error } = await db
  .from('guilds')
  .select('guild_id, name, uninstalled_at')
  .eq('bot_installed', false)
  .not('uninstalled_at', 'is', null)
  .lt('uninstalled_at', cutoff);

if (error) {
  console.error(`Could not list guilds: ${error.message}`);
  process.exit(1);
}
if (!data || data.length === 0) {
  console.log(`Nothing is past the ${RETENTION_DAYS}-day retention window.`);
  process.exit(0);
}
for (const guild of data) {
  console.log(`${guild.guild_id} ${guild.name ?? ''} removed ${guild.uninstalled_at}`);
}
if (!process.argv.includes('--run')) {
  console.log(`\n${data.length} guild(s) would be deleted. Re-run with --run to do it.`);
  process.exit(0);
}
for (const guild of data) {
  const { error: failed } = await db.from('guilds').delete().eq('guild_id', guild.guild_id);
  console.log(`${guild.guild_id}: ${failed ? `failed: ${failed.message}` : 'deleted'}`);
}
