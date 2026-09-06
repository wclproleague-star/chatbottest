// Runs the answer pipeline over evals/cases.json against a guild and checks
// each message's kind and tier, that the draft or found sentence is
// substantive, and that the mod mention is there exactly when it should be.
// Any change to the prompt or the schema runs this and passes every case
// before it is reported.
//
//   pnpm --filter @kalvard/core eval [--guild <id>]

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MODS, answer } from './answer';
import { checkForbidden, checkPersona } from './persona';
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
  /**
   * Tiers that are equally right for this message. A capability refusal is the
   * case in point: whether it lists "not something I do" as an ungrounded claim
   * or as no claim at all, the member sees the same correct reply.
   */
  tierAlso?: AnswerResult['tier'][];
  /** Whether the reply should carry the mod mention. Only meaningful on tier 1. */
  mods?: boolean;
  /** The context a reference is resolved from: who is asking and where. */
  roles?: string[];
  channel?: string;
  category?: string;
  /** What the resolved target must name, and what a clarification must offer. */
  entityMentions?: string | string[];
  candidatesInclude?: string[];
  /** A pattern the reply has to match, for a caveat that must be there. */
  replyMatches?: string;
  /** A pattern the reply must not match, for a thing it must never say. */
  replyNotMatches?: string;
  /**
   * The guild to ask. Defaults to the seed; the hardening guild holds the
   * knowledge the seed must not have, such as two documents that disagree.
   */
  guild?: string;
  /** The messages before this one, oldest first, as the channel would show them. */
  history?: { role: 'user' | 'model'; text: string }[];
};

/** The draft or found sentence must say what was found, never a canned hedge. */
/** How many persona and forbidden-topic checks run after the messages. */
const PERSONA_COUNT = 11;

const CANNED = /not sure about (that|this)/i;

function replyOf(result: AnswerResult): string {
  switch (result.tier) {
    case 'answer':
      return result.answer;
    case 'clarify':
      return result.question;
    case 'partial':
    case 'none':
      return result.reply;
    case 'flagged':
      return `[${result.category}] ${result.note}`;
    case 'sensitive':
    case 'quota':
      return result.reply;
    case 'ignore':
      return '';
  }
}

function foundOf(result: AnswerResult): string | null {
  if (result.tier === 'partial') return result.draft;
  if (result.tier === 'none') return result.found;
  return null;
}

/**
 * Tiers 2 and 3 always carry the mention; a clarification never does, because
 * asking which one is meant is not an escalation; tier 1 carries it only when
 * the case says so.
 */
function expectMods(c: Case, result: AnswerResult): boolean | null {
  if (result.tier === 'partial' || result.tier === 'none') return true;
  if (result.tier === 'clarify') return false;
  if (result.tier === 'flagged') return null;
  return c.mods ?? null;
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

type PersonaCase =
  | { kind: 'persona'; text: string; accept: boolean; why: string }
  | { kind: 'forbidden'; topics: string[]; warn: boolean; why: string };

/**
 * What an owner may tell Kalvard to be. These run here rather than in the unit
 * checks because they are judgements, and they belong next to the answer cases
 * for the same reason: a persona that gets through changes every answer.
 */
async function personaChecks(only: string | null): Promise<number> {
  const cases = JSON.parse(
    readFileSync(fileURLToPath(new URL('../evals/personas.json', import.meta.url)), 'utf8'),
  ) as PersonaCase[];
  let failed = 0;
  console.log(['', 'personas and forbidden topics'].join(String.fromCharCode(10)));
  for (const c of cases) {
    const subject = c.kind === 'persona' ? c.text : c.topics.join('; ');
    if (only && !subject.toLowerCase().includes(only)) continue;
    if (c.kind === 'persona') {
      const verdict = await checkPersona(c.text);
      const ok = verdict.ok === c.accept;
      if (!ok) failed++;
      console.log(`  ${ok ? 'pass' : 'FAIL'}  ${c.accept ? 'accepted' : 'refused'}: ${subject}`);
      if (!ok || verdict.reason) console.log(`        ${verdict.reason || 'accepted'}`);
    } else {
      const warning = await checkForbidden(c.topics);
      const ok = Boolean(warning) === c.warn;
      if (!ok) failed++;
      console.log(`  ${ok ? 'pass' : 'FAIL'}  ${c.warn ? 'warned' : 'quiet'}: ${subject}`);
      if (warning) console.log(`        ${warning}`);
    }
  }
  return failed;
}

async function main(): Promise<void> {
  // One case at a time, when a single expectation is being worked on.
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? '').toLowerCase() : null;
  const guildIndex = process.argv.indexOf('--guild');
  const guildId = guildIndex >= 0 ? (process.argv[guildIndex + 1] ?? SEED_GUILD_ID) : SEED_GUILD_ID;
  const cases = JSON.parse(
    readFileSync(fileURLToPath(new URL('../evals/cases.json', import.meta.url)), 'utf8'),
  ) as Case[];

  let failed = 0;
  console.log(`${pad('message', 44)} ${pad('expected', 24)} ${pad('actual', 24)} result`);
  for (const c of cases) {
    if (only && !c.message.toLowerCase().includes(only)) continue;
    try {
      const result = await answer({
        guildId: c.guild ?? guildId,
        question: c.message,
        askerName: 'kestrel',
        history: c.history,
        asker: { roles: c.roles ?? [], nickname: 'kestrel' },
        channel: { name: c.channel, category: c.category },
      });
      const actual = `${result.kind} / ${result.tier}`;
      const expected = `${c.kind} / ${c.tier}`;
      const problems: string[] = [];
      const tiers = [c.tier, ...(c.tierAlso ?? [])];
      if (result.kind !== c.kind || !tiers.includes(result.tier)) problems.push('kind/tier');
      const found = foundOf(result);
      if (found !== null && (!found.trim() || CANNED.test(found))) problems.push('canned draft');
      const wantMods = expectMods(c, result);
      if (wantMods !== null && wantMods !== replyOf(result).includes(MODS)) {
        problems.push(wantMods ? 'missing {mods}' : 'stray {mods}');
      }
      // A resolved target has to be named in the reply, so the member can see
      // what was answered and correct it.
      const names = c.entityMentions
        ? Array.isArray(c.entityMentions)
          ? c.entityMentions
          : [c.entityMentions]
        : [];
      if (
        names.length > 0 &&
        !names.some((n) => normalise(replyOf(result)).includes(normalise(n)))
      ) {
        problems.push(`the reply never names the target (${names.join(' or ')})`);
      }
      if (c.replyNotMatches && new RegExp(c.replyNotMatches, 'i').test(replyOf(result))) {
        problems.push('the reply says something it must not');
      }
      if (c.replyMatches && !new RegExp(c.replyMatches, 'i').test(replyOf(result))) {
        problems.push('the reply is missing something it must say');
      }
      for (const candidate of c.candidatesInclude ?? []) {
        const offered = result.tier === 'clarify' ? result.candidates.join(' ') : '';
        if (!normalise(`${offered} ${replyOf(result)}`).includes(normalise(candidate))) {
          problems.push(`the question never offers "${candidate}"`);
        }
      }
      if (problems.length > 0) failed++;
      console.log(
        `${pad(c.message, 44)} ${pad(expected, 24)} ${pad(actual, 24)} ${problems.length === 0 ? 'pass' : `FAIL (${problems.join(', ')})`}`,
      );
      console.log(`${' '.repeat(46)}reply: ${replyOf(result).replace(/\s+/g, ' ')}`);
      const r = 'resolution' in result ? result.resolution : undefined;
      if (r) {
        console.log(
          `${' '.repeat(46)}target: ${r.subject}${r.entity ? ` / ${r.entity}` : ''} (${r.outcome}${r.basis ? `, from ${r.basis}` : ''})`,
        );
      }
      if (found !== null) console.log(`${' '.repeat(46)}found: ${found.replace(/\s+/g, ' ')}`);
    } catch (err) {
      failed++;
      console.log(
        `${pad(c.message, 44)} ${pad(`${c.kind} / ${c.tier}`, 24)} ${pad('error', 24)} FAIL     ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  failed += await personaChecks(only);
  const total = cases.length + PERSONA_COUNT;
  console.log(`
${total - failed} of ${total} passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
