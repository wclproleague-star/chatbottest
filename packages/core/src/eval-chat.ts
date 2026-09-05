// Runs the scripted conversations in evals/conversations.json through the tool
// loop. Discord is faked here: the roles, the membership proof and the role
// assignment are supplied by the script, so what is under test is the loop's
// judgement, which tool it reaches for and how the turn ends.
//
//   pnpm --filter @sentrybot/core eval:chat [--guild <id>]

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { converse } from './agent';
import type { ConversationResult, Effects } from './agent';
import { Type, generateJson } from './gemini';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present. Fall through to whatever the environment provides.
  }
}

const SEED_GUILD_ID = '900000000000000001';

type Turn = {
  message: string;
  why: string;
  expect: {
    outcome: ConversationResult['outcome'];
    roleId?: string;
    calls?: string[];
    notCalls?: string[];
    /** The escalation must carry a summary a moderator could act on. */
    summaryAbout?: boolean;
    /** The language the reply has to be written in. */
    language?: string;
    /** Names the reply has to contain, such as every role on offer. */
    mentionsAll?: string[];
    /** The reply must report what happened, never announce what is coming. */
    notAnnounces?: boolean;
  };
};
type Script = {
  name: string;
  roles: { id: string; name: string }[];
  selfServe: string[];
  membership: Record<string, boolean>;
  turns: Turn[];
};

/** What the loop actually did, so the script can assert on it. */
type Trace = { calls: string[]; assigned: string[] };

function fakeEffects(script: Script, trace: Trace): Effects {
  return {
    async listRoles() {
      trace.calls.push('list_roles');
      return script.roles;
    },
    async memberHasRole(_userId, roleId) {
      trace.calls.push('check_membership');
      // The proof asks about the qualifying role, named after the role itself.
      return script.membership[roleId.replace(/_qualifier$/, '')] ?? false;
    },
    async memberInChannel() {
      trace.calls.push('check_membership');
      return false;
    },
    async assignRole(_userId, roleId) {
      trace.calls.push('assign_role');
      trace.assigned.push(roleId);
    },
    async channelName() {
      return null;
    },
  };
}

/** What language a reply is in, and whether it announces rather than reports. */
async function judge(text: string): Promise<{ language: string; announces: boolean }> {
  if (!text.trim()) return { language: 'English', announces: false };
  try {
    return await generateJson<{ language: string; announces: boolean }>({
      system: [
        'Two things about this message.',
        'language: the language it is written in, in English, one word.',
        'announces: true when it says the writer is about to do something ("let me assign you the role", "je vais te donner le rôle"), false when it reports something done or states a fact.',
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { language: { type: Type.STRING }, announces: { type: Type.BOOLEAN } },
        required: ['language', 'announces'],
        propertyOrdering: ['language', 'announces'],
      },
      temperature: 0,
    });
  } catch {
    return { language: 'English', announces: false };
  }
}

function problems(turn: Turn, result: ConversationResult, trace: Trace): string[] {
  const out: string[] = [];
  if (result.outcome !== turn.expect.outcome) {
    out.push(`outcome ${result.outcome}, expected ${turn.expect.outcome}`);
  }
  if (
    turn.expect.roleId &&
    (result.outcome !== 'assigned' || result.roleId !== turn.expect.roleId)
  ) {
    out.push(`did not assign ${turn.expect.roleId}`);
  }
  for (const call of turn.expect.calls ?? []) {
    if (!trace.calls.includes(call)) out.push(`never called ${call}`);
  }
  for (const call of turn.expect.notCalls ?? []) {
    if (trace.calls.includes(call)) out.push(`called ${call}, which it must not`);
  }
  if (
    turn.expect.summaryAbout &&
    result.outcome === 'escalate' &&
    result.summary.trim().length < 20
  ) {
    out.push('the escalation carries no real summary for the moderators');
  }
  return out;
}

async function main(): Promise<void> {
  const guildIndex = process.argv.indexOf('--guild');
  const guildId = guildIndex >= 0 ? (process.argv[guildIndex + 1] ?? SEED_GUILD_ID) : SEED_GUILD_ID;
  const scripts = JSON.parse(
    readFileSync(fileURLToPath(new URL('../evals/conversations.json', import.meta.url)), 'utf8'),
  ) as Script[];

  let failed = 0;
  for (const script of scripts) {
    console.log(`\n${script.name}`);
    // A fresh pair per run, so one script never inherits another's conversation.
    const conversationId = `eval:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    // The loop reads the guild's self-serve roles and proofs from the database,
    // so the script's roles are put there for the length of the run.
    await withSettings(guildId, script, async () => {
      for (const turn of script.turns) {
        const trace: Trace = { calls: [], assigned: [] };
        const result = await converse({
          guildId,
          conversationId,
          userId: 'eval-member',
          askerName: 'kestrel',
          message: turn.message,
          effects: fakeEffects(script, trace),
        });
        const found = problems(turn, result, trace);
        const text = 'text' in result ? result.text : '';
        const wants = turn.expect;
        if (wants.language || wants.notAnnounces) {
          const seen = await judge(text);
          if (
            wants.language &&
            !seen.language.toLowerCase().includes(wants.language.toLowerCase())
          ) {
            found.push(`replied in ${seen.language}, not ${wants.language}`);
          }
          if (wants.notAnnounces && seen.announces) {
            found.push('announced an action instead of reporting one');
          }
        }
        for (const name of wants.mentionsAll ?? []) {
          if (!text.toLowerCase().includes(name.toLowerCase())) {
            found.push(`never offers "${name}"`);
          }
        }
        if (found.length > 0) failed++;
        console.log(`  "${turn.message}"`);
        console.log(`    ${found.length === 0 ? 'pass' : `FAIL: ${found.join('; ')}`}`);
        console.log(`    ${result.outcome}: ${text.replace(/\s+/g, ' ')}`);
        if (result.steps.length > 0) console.log(`    steps: ${result.steps.join(' | ')}`);
      }
    });
  }
  console.log(failed === 0 ? '\nall conversation turns passed.' : `\n${failed} turn(s) failed.`);
  if (failed > 0) process.exitCode = 1;
}

/** Points the guild's self-serve roles and proofs at the script, then puts them back. */
async function withSettings(guildId: string, script: Script, run: () => Promise<void>) {
  const { serviceClient } = await import('./supabase');
  const db = serviceClient();
  const { data: before } = await db
    .from('guild_settings')
    .select('self_serve_role_ids, role_proofs, language')
    .eq('guild_id', guildId)
    .maybeSingle();
  // The proof for every scripted role is "holds the qualifying role", which the
  // fake effects answer from the script's membership map. The language is left
  // unset for the run, so the member's own language governs the reply.
  const proofs = Object.fromEntries(
    script.roles.map((r) => [r.id, { kind: 'has_role', roleId: `${r.id}_qualifier` }]),
  );
  await db
    .from('guild_settings')
    .update({ self_serve_role_ids: script.selfServe, role_proofs: proofs, language: null })
    .eq('guild_id', guildId);
  try {
    await run();
  } finally {
    await db
      .from('guild_settings')
      .update({
        self_serve_role_ids: before?.self_serve_role_ids ?? [],
        role_proofs: before?.role_proofs ?? {},
        language: before?.language ?? null,
      })
      .eq('guild_id', guildId);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
