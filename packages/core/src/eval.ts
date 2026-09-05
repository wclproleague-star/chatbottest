// Runs the answer pipeline over evals/cases.json against a guild and checks
// each message's kind and tier, that the draft or found sentence is
// substantive, and that the mod mention is there exactly when it should be.
// Any change to the prompt or the schema runs this and passes every case
// before it is reported.
//
//   pnpm --filter @sentrybot/core eval [--guild <id>]

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MODS, answer } from './answer';
import type { AnswerResult, Kind } from './answer';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present. Fall through to whatever the environment provides.
  }
}

const SEED_GUILD_ID = '900000000000000001';

type Case = {
  message: string;
  kind: Kind;
  tier: AnswerResult['tier'];
  /** Whether the reply should carry the mod mention. Only meaningful on tier 1. */
  mods?: boolean;
};

/** The draft or found sentence must say what was found, never a canned hedge. */
const CANNED = /not sure about (that|this)/i;

function replyOf(result: AnswerResult): string {
  switch (result.tier) {
    case 'answer':
      return result.answer;
    case 'partial':
    case 'none':
      return result.reply;
    case 'flagged':
      return `[${result.category}] ${result.note}`;
  }
}

function foundOf(result: AnswerResult): string | null {
  if (result.tier === 'partial') return result.draft;
  if (result.tier === 'none') return result.found;
  return null;
}

/** Tiers 2 and 3 always carry the mention; tier 1 carries it only when the case says so. */
function expectMods(c: Case, result: AnswerResult): boolean | null {
  if (result.tier === 'partial' || result.tier === 'none') return true;
  if (result.tier === 'flagged') return null;
  return c.mods ?? null;
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

async function main(): Promise<void> {
  const guildIndex = process.argv.indexOf('--guild');
  const guildId = guildIndex >= 0 ? (process.argv[guildIndex + 1] ?? SEED_GUILD_ID) : SEED_GUILD_ID;
  const cases = JSON.parse(
    readFileSync(fileURLToPath(new URL('../evals/cases.json', import.meta.url)), 'utf8'),
  ) as Case[];

  let failed = 0;
  console.log(`${pad('message', 44)} ${pad('expected', 24)} ${pad('actual', 24)} result`);
  for (const c of cases) {
    try {
      const result = await answer({ guildId, question: c.message });
      const actual = `${result.kind} / ${result.tier}`;
      const expected = `${c.kind} / ${c.tier}`;
      const problems: string[] = [];
      if (actual !== expected) problems.push('kind/tier');
      const found = foundOf(result);
      if (found !== null && (!found.trim() || CANNED.test(found))) problems.push('canned draft');
      const wantMods = expectMods(c, result);
      if (wantMods !== null && wantMods !== replyOf(result).includes(MODS)) {
        problems.push(wantMods ? 'missing {mods}' : 'stray {mods}');
      }
      if (problems.length > 0) failed++;
      console.log(
        `${pad(c.message, 44)} ${pad(expected, 24)} ${pad(actual, 24)} ${problems.length === 0 ? 'pass' : `FAIL (${problems.join(', ')})`}`,
      );
      console.log(`${' '.repeat(46)}reply: ${replyOf(result).replace(/\s+/g, ' ')}`);
      if (found !== null) console.log(`${' '.repeat(46)}found: ${found.replace(/\s+/g, ' ')}`);
    } catch (err) {
      failed++;
      console.log(
        `${pad(c.message, 44)} ${pad(`${c.kind} / ${c.tier}`, 24)} ${pad('error', 24)} FAIL     ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`\n${cases.length - failed} of ${cases.length} passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
