// A second seeded guild, for the cases that need knowledge the main seed must
// not have: two documents that contradict each other, and a fact that exists
// here and nowhere else, so cross-guild isolation can be tested by asking the
// other guild about it.
//
//   pnpm --filter @kalvard/core seed:hardening

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
const { ingest } = await import('./ingest');

export const HARDENING_GUILD_ID = '900000000000000002';

const DOCUMENTS = [
  {
    id: '00000000-0000-4000-8000-00000000c001',
    title: 'Check-in policy',
    text: 'Check-in opens two hours before the match and closes one hour before it starts. A team that has not checked in by then forfeits the first map.',
  },
  {
    id: '00000000-0000-4000-8000-00000000c002',
    title: 'Check-in policy, staff copy',
    text: 'Check-in closes thirty minutes before the match starts. Captains who miss it should post in the match channel.',
  },
  {
    id: '00000000-0000-4000-8000-00000000c003',
    title: 'Hardening league trophy',
    text: 'The trophy of this league is called the Obsidian Kite and it is awarded in the last week of the season.',
  },
];

const db = serviceClient();

await db
  .from('guilds')
  .upsert({ guild_id: HARDENING_GUILD_ID, name: 'Hardening', bot_installed: false });
await db.from('guild_settings').upsert({
  guild_id: HARDENING_GUILD_ID,
  bot_name: 'Kalvard',
  persona_prompt: 'You answer questions for a small competitive league. Be short and exact.',
  language: null,
  fallback_mode: 'ping_role',
  confidence_threshold: 0.55,
  allowed_actions: ['point_to_channel', 'escalate'],
  // Two roles the bot may hand out itself, so the cases about what it can and
  // cannot do have something real to be about.
  self_serve_role_ids: ['role_ff_hard', 'role_eu_hard'],
  // The suites ask thousands of questions; the monthly allowance is a real
  // product limit and not something the tests should keep tripping over.
  limits: { monthlyAnswers: 1000000 },
});

for (const doc of DOCUMENTS) {
  await db.from('documents').upsert({
    id: doc.id,
    guild_id: HARDENING_GUILD_ID,
    title: doc.title,
    source_type: 'paste',
    raw_text: doc.text,
    status: 'processing',
  });
  const result = await ingest({ guildId: HARDENING_GUILD_ID, documentId: doc.id });
  console.log(`${doc.title}: ${result.chunkCount ?? 0} chunks`);
}
console.log(`hardening guild ${HARDENING_GUILD_ID} is ready.`);
