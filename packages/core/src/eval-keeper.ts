// The keeper, in a series channel: what it answers, what it leaves alone,
// and what only staff may move.
//
// A scripted channel during a live best-of-three. The run's memory is a real
// series context part-way through game 1; the messages are how people
// actually write in a match channel. The model decides; the guards that are
// code — players never move the run, one unprompted line a minute, never the
// same line twice — are checked here too, with the model out of the way.
//
//   pnpm --filter @kalvard/core eval:keeper

import process from 'node:process';
import { fileURLToPath } from 'node:url';
for (const f of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${f}`, import.meta.url)));
  } catch {
    /* absent */
  }
}
const { keep, guard, memoryOf } = await import('./keeper');
const { BO3_SERIES, seriesContext } = await import('./workflows/series');
import type { KeeperInput, KeeperDecision } from './keeper';

let failed = 0;
function check(what: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
}

// Game 1, draft open, nobody has picked yet.
const variables = {
  ...seriesContext({
    teamA: { name: 'CEO', roleId: 'role-a' },
    teamB: { name: 'PPG', roleId: 'role-b' },
    channel: 'c',
    results: 'results',
    rules: 'Best of three. Loser of a game picks side for the next.',
    mods: '@mods',
  }),
  blue: { name: 'PPG', roleId: 'role-b' },
  red: { name: 'CEO', roleId: 'role-a' },
  draft: {
    id: 'draft-1',
    status: 'waiting',
    game: 1,
    blueUrl: 'https://draft.example/session/draft-1/blue',
    redUrl: 'https://draft.example/session/draft-1/red',
  },
};

const RULES = [
  ...(BO3_SERIES.rules ?? []),
  'A team may be up to 15 minutes late if staff approves it; after that the game is forfeited.',
];

function input(
  message: KeeperInput['message'],
  recent: KeeperInput['recent'] = [],
  extra: Partial<KeeperInput> = {},
): KeeperInput {
  return {
    botName: 'Kalvard',
    brief: BO3_SERIES.brief ?? '',
    rules: RULES,
    memory: memoryOf(variables),
    waiting: 'the draft to finish on the site (30 minutes at most)',
    knowledge: [],
    recent,
    message,
    lastSaid: null,
    language: 'English',
    ...extra,
  };
}

const said = (d: KeeperDecision): string => `${d.decision}: ${d.reply} (${d.why})`;

console.log(['', 'the memory reads like facts'].join(String.fromCharCode(10)));
const memory = memoryOf(variables);
check(
  'it names the series and the sides',
  memory.some((m) => m.includes('PPG blue')),
  memory.join(' | '),
);
check(
  'and the draft state',
  memory.some((m) => m.includes('nobody has picked yet')),
  memory.join(' | '),
);
check('and never an id', !memory.some((m) => /role-[ab]/.test(m)), memory.join(' | '));

console.log(['', 'banter is left alone'].join(String.fromCharCode(10)));
for (const text of ['gg ez', 'lol no way', 'yo who is jungling', 'brb 2 min']) {
  const d = await keep(input({ who: 'Joelz', text, isStaff: false, mentionsBot: false }));
  check(`"${text}" → ignore`, d.decision === 'ignore', said(d));
}

console.log(
  ['', 'a question about the series is answered from memory'].join(String.fromCharCode(10)),
);
{
  const d = await keep(
    input({
      who: 'Joelz',
      text: 'where are we at with the draft?',
      isStaff: false,
      mentionsBot: false,
    }),
  );
  check('it answers', d.decision === 'answer', said(d));
  check(
    'from the memory: the draft is open and unstarted',
    /open|not started|nobody|hasn't|has not|waiting|pick/i.test(d.reply),
    d.reply,
  );
  check('in one or two lines', d.reply.split('\n').length <= 2 && d.reply.length <= 400, d.reply);
}
{
  const d = await keep(
    input({ who: 'Joelz', text: 'what side are we on?', isStaff: false, mentionsBot: false }),
  );
  check('sides come from memory', d.decision === 'answer' && /blue|red/i.test(d.reply), said(d));
}

console.log(['', "time is the rule, and the exception is staff's"].join(String.fromCharCode(10)));
{
  const d = await keep(
    input({
      who: 'Joelz',
      text: "we'll be 10 min late, our support is stuck in traffic",
      isStaff: false,
      mentionsBot: false,
    }),
  );
  check(
    'a player asking for time gets the rule, not the minutes',
    d.decision !== 'act' && d.extendDeadlineMinutes === 0,
    said(d),
  );
  check('and the rule names 15 minutes', /15/.test(d.reply), d.reply);
}
{
  const d = await keep(
    input({
      who: 'Joelz',
      text: 'ok we take the 15 minutes then, approved',
      isStaff: false,
      mentionsBot: false,
    }),
  );
  check(
    'a player approving themselves moves nothing',
    d.decision !== 'act' && d.extendDeadlineMinutes === 0,
    said(d),
  );
}
{
  const d = await keep(
    input({
      who: 'Legosi',
      text: 'approved, 15 more minutes for PPG',
      isStaff: true,
      mentionsBot: false,
    }),
  );
  check('staff granting time is an act', d.decision === 'act', said(d));
  check('of fifteen minutes', d.extendDeadlineMinutes === 15, String(d.extendDeadlineMinutes));
  check('acknowledged in one line', d.reply.length > 0 && d.reply.split('\n').length <= 2, d.reply);
}

console.log(['', 'what nothing here holds goes to staff'].join(String.fromCharCode(10)));
{
  const d = await keep(
    input({
      who: 'Joelz',
      text: "can we remake the game? their adc dc'd at 2 minutes",
      isStaff: false,
      mentionsBot: false,
    }),
  );
  check('a remake is for staff', d.decision === 'escalate', said(d));
}

console.log(['', 'the guards that are code'].join(String.fromCharCode(10)));
{
  const player = input({
    who: 'Joelz',
    text: 'give us 15 more min',
    isStaff: false,
    mentionsBot: false,
  });
  const forced = guard(
    {
      decision: 'act',
      reply: 'Sure, 15 more minutes.',
      extendDeadlineMinutes: 15,
      remember: 'PPG late',
      why: 'x',
    },
    player,
  );
  check(
    'a model granting a player time is overruled',
    forced.decision === 'escalate' && forced.extendDeadlineMinutes === 0 && forced.remember === '',
    JSON.stringify(forced),
  );
  const at = new Date('2026-09-12T18:00:00Z');
  const twice = guard(
    {
      decision: 'answer',
      reply: 'The draft is open, links above.',
      extendDeadlineMinutes: 0,
      remember: '',
      why: 'x',
    },
    input({ who: 'Joelz', text: 'draft?', isStaff: false, mentionsBot: false }, [], {
      lastSaid: {
        text: 'The draft is open, links above.',
        at: new Date(at.getTime() - 300_000).toISOString(),
      },
      now: at,
    }),
  );
  check('the same line is never said twice', twice.decision === 'ignore', JSON.stringify(twice));
  const soon = guard(
    {
      decision: 'answer',
      reply: 'Blue side is PPG.',
      extendDeadlineMinutes: 0,
      remember: '',
      why: 'x',
    },
    input({ who: 'Joelz', text: 'sides?', isStaff: false, mentionsBot: false }, [], {
      lastSaid: { text: 'The draft is open.', at: new Date(at.getTime() - 20_000).toISOString() },
      now: at,
    }),
  );
  check(
    'an unprompted line within a minute of the last is held',
    soon.decision === 'ignore',
    JSON.stringify(soon),
  );
  const asked = guard(
    {
      decision: 'answer',
      reply: 'Blue side is PPG.',
      extendDeadlineMinutes: 0,
      remember: '',
      why: 'x',
    },
    input({ who: 'Joelz', text: '@Kalvard sides?', isStaff: false, mentionsBot: true }, [], {
      lastSaid: { text: 'The draft is open.', at: new Date(at.getTime() - 20_000).toISOString() },
      now: at,
    }),
  );
  check(
    'but a question put to it is always answered',
    asked.decision === 'answer',
    JSON.stringify(asked),
  );
  const long = guard(
    {
      decision: 'answer',
      reply: 'one\ntwo\nthree\nfour',
      extendDeadlineMinutes: 0,
      remember: '',
      why: 'x',
    },
    input({ who: 'Joelz', text: '@Kalvard sides?', isStaff: false, mentionsBot: true }),
  );
  check('a reply is cut to two lines', long.reply === 'one\ntwo', long.reply);
}

console.log(failed === 0 ? '\nthe keeper kept its place.' : `\n${failed} keeper check(s) failed.`);
if (failed > 0) process.exitCode = 1;
