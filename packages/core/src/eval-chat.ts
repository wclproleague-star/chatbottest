// Runs the scripted conversations in evals/conversations.json through the tool
// loop. Discord is faked here: the roles, the membership proof and the role
// assignment are supplied by the script, so what is under test is the loop's
// judgement, which tool it reaches for and how the turn ends.
//
//   pnpm --filter @kalvard/core eval:chat [--guild <id>]

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Json } from './database.types';
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
    outcome?: ConversationResult['outcome'];
    /** For a turn that may legitimately end more than one way. */
    outcomeOneOf?: ConversationResult['outcome'][];
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
    /** Words the reply must not contain, such as an earlier answer's subject. */
    mentionsNone?: string[];
    /** It must say plainly that it cannot look this up, rather than guess. */
    saysCannotLookUp?: boolean;
    /** A refusal must say what it can do instead, not stop at "I cannot". */
    saysWhatItCanDo?: boolean;
    /** French must be tutoiement, with no helpdesk apology. */
    informalFrench?: boolean;
  };
};
type Script = {
  name: string;
  /** The data sources this guild has for the run, as the owner would add them. */
  sources?: { id: string; name: string; answers: string; kind: string; config: Json }[];
  /** When set, Discord refuses the assignment for this reason. */
  cannotAssign?: 'missing_permission' | 'role_too_high' | 'unknown';
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
      // A script can make Discord refuse, to check what the member is told.
      if (script.cannotAssign) return { ok: false, reason: script.cannotAssign };
      trace.assigned.push(roleId);
      return { ok: true };
    },
    async channelName() {
      return null;
    },
  };
}

/** Everything the scripts assert about the wording of one reply. */
type Judged = {
  language: string;
  announces: boolean;
  cannotLookUp: boolean;
  saysWhatItCanDo: boolean;
  formal: boolean;
};

async function judge(text: string): Promise<Judged> {
  const fallback: Judged = {
    language: 'English',
    announces: false,
    cannotLookUp: false,
    saysWhatItCanDo: false,
    formal: false,
  };
  if (!text.trim()) return fallback;
  try {
    return await generateJson<Judged>({
      system: [
        'Five things about this message from a Discord bot.',
        'language: the language it is written in, in English, one word.',
        'announces: true when it says the writer is about to do something ("let me assign you the role"), false when it reports something done or states a fact.',
        'cannotLookUp: true when it says plainly that it has no way to look this up or has no live data, rather than answering with a value.',
        'saysWhatItCanDo: true when it names something concrete it can do instead, not merely refusing.',
        'formal: true when French uses vouvoiement, or when it apologises for a misunderstanding ("désolé pour la confusion") or closes like a helpdesk. False for plain tutoiement, and false for any message not in French.',
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: {
          language: { type: Type.STRING },
          announces: { type: Type.BOOLEAN },
          cannotLookUp: { type: Type.BOOLEAN },
          saysWhatItCanDo: { type: Type.BOOLEAN },
          formal: { type: Type.BOOLEAN },
        },
        required: ['language', 'announces', 'cannotLookUp', 'saysWhatItCanDo', 'formal'],
        propertyOrdering: ['language', 'announces', 'cannotLookUp', 'saysWhatItCanDo', 'formal'],
      },
      temperature: 0,
    });
  } catch {
    return fallback;
  }
}

function problems(turn: Turn, result: ConversationResult, trace: Trace): string[] {
  const out: string[] = [];
  const allowed = turn.expect.outcomeOneOf ?? (turn.expect.outcome ? [turn.expect.outcome] : []);
  if (allowed.length > 0 && !allowed.includes(result.outcome)) {
    out.push(`outcome ${result.outcome}, expected ${allowed.join(' or ')}`);
  }
  if (
    turn.expect.roleId &&
    (result.outcome !== 'assigned' || result.roleId !== turn.expect.roleId)
  ) {
    out.push(`did not assign ${turn.expect.roleId}`);
  }
  // Reaching for a tool and getting it done are different things. calls asks
  // what the turn tried, so it counts refused attempts; notCalls asks what
  // must not happen to the member, so it counts only what Discord actually did.
  const tried = [...trace.calls, ...result.calls];
  for (const call of turn.expect.calls ?? []) {
    if (!tried.includes(call)) out.push(`never called ${call}`);
  }
  for (const call of turn.expect.notCalls ?? []) {
    if (trace.calls.includes(call)) out.push(`${call} actually happened, and must not`);
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
        if (
          wants.language ||
          wants.notAnnounces ||
          wants.saysCannotLookUp ||
          wants.saysWhatItCanDo ||
          wants.informalFrench
        ) {
          const seen = await judge(text);
          if (wants.saysCannotLookUp && !seen.cannotLookUp) {
            found.push('did not say plainly that it cannot look this up');
          }
          if (wants.saysWhatItCanDo && !seen.saysWhatItCanDo) {
            found.push('refused without saying what it can do instead');
          }
          if (wants.informalFrench && seen.formal) {
            found.push('vouvoiement or a helpdesk apology, not one of the moderators talking');
          }
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
        for (const word of wants.mentionsNone ?? []) {
          if (new RegExp(`\\b${word}\\b`, 'iu').test(text)) {
            found.push(`reused "${word}" from an earlier answer`);
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
    .select('self_serve_role_ids, role_proofs, language, data_sources')
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
    .update({
      self_serve_role_ids: script.selfServe,
      role_proofs: proofs,
      language: null,
      data_sources: (script.sources ?? []) as unknown as Json,
    })
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
        data_sources: before?.data_sources ?? [],
      })
      .eq('guild_id', guildId);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
