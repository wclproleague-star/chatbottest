// Gives the documents a server already has the note they were never asked for.
//
// From now on a document is described as it is read in. The ones already in a
// server predate that, and re-ingesting them would re-embed everything for no
// reason, so the note is written on its own here: read the text, write the
// sentence, save it. Nothing else about the document is touched, and a
// document that already has one is left alone.
//
//   pnpm --filter @kalvard/core notes [--guild <id>]

import process from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const file of ['.env.local', '.env']) {
  const path = fileURLToPath(new URL(`../../../${file}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

const { describeDocument } = await import('./describe');
const { serviceClient } = await import('./supabase');

/** The guild the seed makes, which is what the evals run against. */
const SEED_GUILD_ID = '900000000000000001';

const at = process.argv.indexOf('--guild');
const guildId = at >= 0 ? (process.argv[at + 1] ?? SEED_GUILD_ID) : SEED_GUILD_ID;

const db = serviceClient();
const { data, error } = await db
  .from('documents')
  .select('id, title, source_type, raw_text, summary, status')
  .eq('guild_id', guildId);
if (error) throw new Error(error.message);

let written = 0;
for (const doc of data ?? []) {
  if (doc.summary?.trim()) continue;
  const text = doc.raw_text?.trim();
  if (!text) {
    console.log(`- ${doc.title ?? doc.id}: uploaded file, skipped`);
    continue;
  }
  const note = await describeDocument({
    title: doc.title,
    text,
    sourceType: doc.source_type,
  });
  if (!note) {
    console.log(`- ${doc.title ?? doc.id}: nothing certain to say, left blank`);
    continue;
  }
  await db.from('documents').update({ summary: note }).eq('id', doc.id);
  written++;
  console.log(`- ${doc.title ?? doc.id}: ${note}`);
}
console.log(`${written} note(s) written in guild ${guildId}.`);
