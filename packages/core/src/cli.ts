// Runs the pipeline against a guild from the command line.
//
//   pnpm --filter @kalvard/core cli ingest [--guild <id>]
//   pnpm --filter @kalvard/core cli ask "<question>" [--guild <id>]
//
// Defaults to the guild seeded by supabase/seed.sql.

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MODS, answer } from './answer';
import { ingest } from './ingest';
import { serviceClient } from './supabase';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present. Fall through to whatever the environment provides.
  }
}

const SEED_GUILD_ID = '900000000000000001';

const USAGE = `Usage:
  cli ingest [--guild <id>]            ingest every document in the guild
  cli ask "<question>" [--guild <id>]  answer one question
Defaults to the seed guild ${SEED_GUILD_ID}.`;

function parseArgs(argv: string[]): { command?: string; positional: string[]; guild: string } {
  let guild = SEED_GUILD_ID;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--guild') {
      guild = argv[++i] ?? guild;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  const [command, ...rest] = positional;
  return { command, positional: rest, guild };
}

async function runIngest(guildId: string): Promise<void> {
  const { data: docs, error } = await serviceClient()
    .from('documents')
    .select('id, title')
    .eq('guild_id', guildId)
    .order('created_at');
  if (error) throw new Error(`Could not list documents: ${error.message}`);
  if (!docs || docs.length === 0) {
    console.log(`No documents in guild ${guildId}. Seed the database first.`);
    return;
  }
  console.log(`Ingesting ${docs.length} document(s) for guild ${guildId}`);
  for (const doc of docs) {
    const started = Date.now();
    const label = doc.title ?? doc.id;
    try {
      const result = await ingest({ guildId, documentId: doc.id });
      console.log(`  ready  ${label}  (${result.chunkCount} chunks, ${Date.now() - started}ms)`);
    } catch (err) {
      console.log(`  error  ${label}  ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}

async function runAsk(guildId: string, question: string): Promise<void> {
  const started = Date.now();
  const result = await answer({ guildId, question });
  const ms = Date.now() - started;

  const mods = (text: string) => text.split(MODS).join('@Mods');
  console.log(`Q: ${question}`);
  switch (result.tier) {
    case 'answer':
      console.log(`A: ${result.answer}`);
      console.log(
        `   tier 1 answer (${result.kind}), confidence ${result.confidence.toFixed(2)}, ${result.claims.length} claim(s), used ${result.usedChunkIds.length} of ${result.topChunkIds.length} matched chunk(s)` +
          (result.action ? `, action ${JSON.stringify(result.action)}` : '') +
          `, ${ms}ms`,
      );
      break;
    case 'partial':
      console.log(`A: ${mods(result.reply)}`);
      console.log(
        `   tier 2 partial: posted with the mod mention and stored pending. confidence ${result.confidence.toFixed(2)}, used ${result.usedChunkIds.length} of ${result.topChunkIds.length} matched chunk(s), ${ms}ms`,
      );
      break;
    case 'none':
      console.log(`A: ${mods(result.reply)}`);
      console.log(
        `   tier 3 none (${result.reason}${result.refusalReason ? `: ${result.refusalReason}` : ''}): posted with the mod mention. ${result.topChunkIds.length} chunk(s) matched, ${ms}ms`,
      );
      break;
    case 'flagged':
      console.log(
        `   tier 4 flagged (${result.category}): no public reply. Report to the mod channel: ${result.note} ${ms}ms`,
      );
      break;
  }
  console.log('result:', JSON.stringify(result));
}

async function main(): Promise<void> {
  const { command, positional, guild } = parseArgs(process.argv.slice(2));
  if (command === 'ingest') return runIngest(guild);
  if (command === 'ask') {
    const question = positional.join(' ').trim();
    if (!question) {
      console.error('ask needs a question.\n' + USAGE);
      process.exitCode = 2;
      return;
    }
    return runAsk(guild, question);
  }
  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
