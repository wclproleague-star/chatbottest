// The match-day workflow, run against the fixture, on a Thursday.
//
// This needs no model and no Discord: the league is the fixture, the effects
// are refused, and the run is a dry run, so what is checked is the flow itself.
// The fixture's week-six matches fall on Thursday 10 September 2026, which is
// the day this runs; the Sunday after it has nothing, and a run on that day
// must do nothing rather than announce something it made up.
//
//   pnpm --filter @kalvard/core eval:workflow

import process from 'node:process';
import { MATCH_DAY, matchDayContext } from './workflows/match-day';
import { WORKFLOW_ACTIONS, resumeWorkflow, runWorkflow } from './workflows';
import type { WorkflowEffects, RunEvent, RunResult, RunState } from './workflows';
import { BO3_SERIES, seriesContext } from './workflows/series';
import { runOp } from './sources';
import { FIXTURE_LOOKS_TO_DONE, resetDraftFixture } from './fetchers/draft-flow';

const THURSDAY = new Date('2026-09-10T17:00:00.000Z');
const SUNDAY = new Date('2026-09-13T17:00:00.000Z');

const SOURCE = {
  id: 'league',
  name: 'the league schedule',
  answers: 'fixtures, times, results and rosters',
  kind: 'rift_legends',
  config: { baseUrl: 'fixture:rift-legends' },
};

let failed = 0;
function check(what: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
}

/** Effects that refuse to do anything, which is the point of a dry run. */
function refusing(calls: string[]): WorkflowEffects {
  return {
    async say() {
      calls.push('postMessage');
      return {};
    },
    async ask() {
      calls.push('askButtons');
    },
    async react() {
      calls.push('addReaction');
    },
    async keepAtTop() {
      calls.push('pinMessage');
    },
    async roomId(name: string) {
      return name === 'match-info' ? 'channel-match-info' : null;
    },
  };
}

const said = (result: RunResult): string =>
  result.entries.map((e) => `${e.step}: ${e.detail}`).join(String.fromCharCode(10));

console.log(['', 'match day, Thursday'].join(String.fromCharCode(10)));
const calls: string[] = [];
const context = await matchDayContext(SOURCE, THURSDAY, 'Europe/Paris');
check('it found the day', context.day === '2026-09-10', context.day);
check('both matches are on it', context.matches.length === 2, String(context.matches.length));
check(
  'the captains came from the roster',
  context.matches[0]?.captains.length === 2,
  JSON.stringify(context.matches[0]?.captainHandles),
);

const thursday = await runWorkflow({
  guildId: '900000000000000001',
  workflow: MATCH_DAY,
  context: context as unknown as Record<string, unknown>,
  effects: refusing(calls),
  allowedActions: [...WORKFLOW_ACTIONS],
  dryRun: true,
  now: THURSDAY,
});
const transcript = said(thursday);

check('nothing was actually done', calls.length === 0, calls.join(', '));
check('it did not stop', !thursday.stoppedBecause, thursday.stoppedBecause ?? '');
check(
  'both matches were announced',
  (transcript.match(/post_message/g) ?? []).length >= 2,
  transcript,
);
check('the announcement names the teams', transcript.includes('Fast Forward vs Baguette'));
check('and the time where the guild lives', /\b21:00\b/.test(transcript), transcript);
check('the captains were asked, by id', transcript.includes('1001') && transcript.includes('2001'));
check('with buttons, not a typed answer', transcript.includes('Ready / Not yet'));
check(
  'the coin flip says what it landed on',
  /Coin flip for Fast Forward vs Baguette: (Fast Forward|Baguette) picks side first/.test(
    transcript,
  ),
  transcript,
);
check(
  'it waits for the screenshot from the captains',
  thursday.waiting.some((w) => w.what === 'attachment' && w.minutes === 30),
);
check(
  'and nudges before it wakes anyone',
  thursday.waiting.some((w) => w.what === 'attachment' && w.onTimeout.includes('post_message')),
);
check(
  'every wait names who may satisfy it',
  thursday.waiting.every((w) => w.from.trim().length > 0),
);
check(
  'every wait has something to do when it runs out',
  thursday.waiting.every((w) => w.minutes > 0 && w.onTimeout !== 'nothing'),
);

console.log(['', 'a day with no matches'].join(String.fromCharCode(10)));
const quiet = await matchDayContext(SOURCE, SUNDAY, 'Europe/Paris');
const sunday = await runWorkflow({
  guildId: '900000000000000001',
  workflow: MATCH_DAY,
  context: quiet as unknown as Record<string, unknown>,
  effects: refusing(calls),
  allowedActions: [...WORKFLOW_ACTIONS],
  dryRun: true,
  now: SUNDAY,
});
check('it finds nothing on', quiet.matches.length === 0);
check('and says nothing at all', sunday.entries.length === 0, said(sunday));

console.log(['', 'what an owner has not allowed'].join(String.fromCharCode(10)));
const locked = await runWorkflow({
  guildId: '900000000000000001',
  workflow: MATCH_DAY,
  context: context as unknown as Record<string, unknown>,
  effects: refusing(calls),
  // The owner switched posting off.
  allowedActions: ['ask_buttons'],
  dryRun: true,
  now: THURSDAY,
});
check('the run stops rather than doing it anyway', Boolean(locked.stoppedBecause));
check(
  'and says which action it lacked',
  (locked.stoppedBecause ?? '').includes('post_message'),
  locked.stoppedBecause ?? '',
);

console.log(['', 'a channel that is gone'].join(String.fromCharCode(10)));
const noChannel = await runWorkflow({
  guildId: '900000000000000001',
  workflow: MATCH_DAY,
  context: context as unknown as Record<string, unknown>,
  effects: {
    ...refusing(calls),
    async roomId() {
      return null;
    },
  },
  allowedActions: [...WORKFLOW_ACTIONS],
  now: THURSDAY,
});
check('a live run stops rather than guessing a channel', Boolean(noChannel.stoppedBecause));
check(
  'and names the channel it wanted',
  (noChannel.stoppedBecause ?? '').includes('match-info'),
  noChannel.stoppedBecause ?? '',
);

// The Bo3 series --------------------------------------------------------
// A whole best-of-three, scripted: two fake teams, the draft site played by
// the fixture, screenshots read by a scripted reader, and the clock moved by
// hand. What is checked is the flow: who gets pinged, what fires on silence,
// what is refused, and what reaches the results channel.

console.log(['', 'a best-of-three, start to finish'].join(String.fromCharCode(10)));
resetDraftFixture();

const A = { name: 'CEO', roleId: 'role-a' };
const B = { name: 'PPG', roleId: 'role-b' };
const ALICE = { id: 'u-alice', roles: ['role-a'] }; // team A
const ANNE = { id: 'u-anne', roles: ['role-a'] }; // team A, not the reporter
const BOB = { id: 'u-bob', roles: ['role-b'] }; // team B
const NOBODY = { id: 'u-rando', roles: [] as string[] };

const posted: { channel: string; text: string; attachments?: string[] }[] = [];
const fetched: { op: string; args: Record<string, string> }[] = [];
const asked: { question: string; who: string[] }[] = [];
const DRAFT_SOURCE = {
  id: 'draft',
  name: 'the draft site',
  answers: 'draft sessions',
  kind: 'draft_flow',
  config: { baseUrl: 'fixture:draft-flow' },
};
const effects: WorkflowEffects = {
  async say({ roomId, text, attachments }) {
    posted.push({ channel: roomId, text, attachments });
    return {};
  },
  async ask({ question, whoMayAnswer }) {
    asked.push({ question, who: whoMayAnswer });
  },
  async react() {},
  async keepAtTop() {},
  async roomId(name: string) {
    return name === 'results' ? 'channel-results' : name;
  },
  fetch: (source, op, args) => {
    fetched.push({ op, args });
    return runOp([DRAFT_SOURCE], source, op, args);
  },
  // The scripted reader: the file name says what the model would have said.
  async readImage(url) {
    if (url.includes('lobby')) {
      return { isEndScreen: false, result: 'unknown', confidence: 0.9, seen: 'a lobby' };
    }
    if (url.includes('defeat')) {
      return { isEndScreen: true, result: 'defeat', confidence: 0.95, seen: 'DEFEAT screen' };
    }
    return { isEndScreen: true, result: 'victory', confidence: 0.95, seen: 'VICTORY screen' };
  },
};

let clock = new Date('2026-09-12T18:00:00.000Z');
const minutes = (n: number): Date => new Date(clock.getTime() + n * 60_000);
const run = await runWorkflow({
  guildId: '900000000000000001',
  workflow: BO3_SERIES,
  context: seriesContext({
    teamA: A,
    teamB: B,
    channel: 'channel-match',
    results: 'results',
    rules: 'Best of three. Loser of a game picks side for the next.',
    mods: '@mods',
  }),
  effects,
  allowedActions: [...WORKFLOW_ACTIONS],
  now: clock,
});
let state = run.state as RunState;
const lastPost = (): string => posted.at(-1)?.text ?? '';
const since = (n: number): string =>
  posted
    .slice(n)
    .map((p) => p.text)
    .join(' | ');
async function feed(event: RunEvent, at: Date): Promise<{ taken: boolean; say?: string }> {
  clock = at;
  const out = await resumeWorkflow(state, event, {
    guildId: '900000000000000001',
    effects,
    allowedActions: [...WORKFLOW_ACTIONS],
    now: at,
  });
  if (out.taken) state = out.state;
  return out;
}

check(
  'the greeting mentions both teams',
  posted[0]?.text.includes('<@&role-a>') === true &&
    posted[0]?.text.includes('<@&role-b>') === true,
  posted[0]?.text ?? '',
);
check('and reads back the rules', posted[0]?.text.includes('Loser of a game picks side') === true);
check(
  'the coin flip is announced',
  /Coin flip for side: (CEO|PPG) starts on blue side/.test(posted[1]?.text ?? ''),
  posted[1]?.text ?? '',
);
const blueFirst = (run.variables.blue as { roleId: string }).roleId;
const redFirst = (run.variables.red as { roleId: string }).roleId;
const links = posted.find((p) => p.text.includes('📝 Game'))?.text ?? '';
check(
  'the blue link goes to the blue team',
  links.includes(`<@&${blueFirst}> blue: https://draft.example/session/draft-1/blue`),
  links,
);
check(
  'and the red link to the red team',
  links.includes(`<@&${redFirst}> red: https://draft.example/session/draft-1/red`),
  links,
);
check('it is waiting on the draft site', state?.wait?.kind === 'poll', JSON.stringify(state?.wait));

// One minute of silence: the first nudge, and a look that finds the draft started.
let before = posted.length;
await feed({ kind: 'tick' }, minutes(1));
check(
  'after a minute it asks whether the draft started',
  posted.slice(before).some((p) => p.text.includes('Did you start the draft')),
  since(before),
);
before = posted.length;
await feed({ kind: 'tick' }, minutes(2));
check(
  'the second nudge stays quiet once drafting has begun',
  !posted.slice(before).some((p) => p.text.includes('has not started')),
  since(before),
);
for (let i = 0; state.wait?.kind === 'poll' && i < 20; i++)
  await feed({ kind: 'tick' }, minutes(3 + i));
check(
  `the draft finished after ${FIXTURE_LOOKS_TO_DONE} looks`,
  posted.some((p) => p.text.startsWith('Game 1 draft done.')),
  lastPost(),
);
check(
  'the blue team is told to make the lobby',
  posted.some((p) => p.text.includes(`<@&${blueFirst}> create the lobby`)),
);
check(
  'then it waits two minutes for a word from either team',
  state.wait?.event === 'message' && state.wait.from.includes(blueFirst),
  JSON.stringify(state.wait),
);

// Nobody says anything: one check-in, then the screenshot wait.
clock = new Date(state.wait!.deadline);
before = posted.length;
await feed({ kind: 'tick' }, minutes(1));
check(
  'after two quiet minutes it asks once',
  posted.slice(before).some((p) => p.text.includes('Everything fine?')),
  since(before),
);
check(
  'and waits for a screenshot from either team',
  state.wait?.event === 'attachment' && state.wait.from.length === 2,
  JSON.stringify(state.wait),
);

// Live, the end screen came straight after the draft card, while the run was
// only listening for a word: it must count as the screenshot, not the word.
{
  // A run of its own: what it reads from the site is not the series' record.
  const kept = fetched.splice(0);
  const early = await runWorkflow({
    guildId: '900000000000000001',
    workflow: BO3_SERIES,
    context: seriesContext({
      teamA: A,
      teamB: B,
      channel: 'channel-match',
      results: 'results',
      rules: '',
      mods: '@mods',
    }),
    effects,
    allowedActions: [...WORKFLOW_ACTIONS],
    now: clock,
  });
  let quick = early.state as RunState;
  const step = async (event: RunEvent, at: Date) => {
    const out = await resumeWorkflow(quick, event, {
      guildId: '900000000000000001',
      effects,
      allowedActions: [...WORKFLOW_ACTIONS],
      now: at,
    });
    if (out.taken) quick = out.state;
    return out;
  };
  for (let i = 0; quick.wait?.kind === 'poll' && i < 20; i++) {
    await step({ kind: 'tick' }, minutes(1 + i));
  }
  check(
    '(early) the run is listening for a word',
    quick.wait?.event === 'message',
    JSON.stringify(quick.wait),
  );
  const n = posted.length;
  const blueRole = (quick.variables.blue as { roleId: string }).roleId;
  const poster = blueRole === 'role-a' ? ALICE : BOB;
  await step(
    {
      kind: 'message',
      from: poster.id,
      roles: poster.roles,
      text: '',
      attachments: ['https://cdn.example/g1-defeat.png'],
    },
    minutes(1),
  );
  check(
    'a screenshot posted before the check-in counts as the screenshot',
    posted.slice(n).some((p) => p.text.includes('wins')),
    since(n),
  );
  check(
    '(early) the reporter is set from it',
    quick.variables.reporter === poster.id,
    String(quick.variables.reporter),
  );
  fetched.splice(0, fetched.length, ...kept);
}

// A picture that is not an end screen is refused and the wait holds.
const stranger = await feed(
  {
    kind: 'message',
    from: NOBODY.id,
    roles: NOBODY.roles,
    text: '',
    attachments: ['https://cdn.example/lobby.png'],
  },
  minutes(2),
);
check('a screenshot from neither team is not taken', !stranger.taken);
before = posted.length;
await feed(
  {
    kind: 'message',
    from: ALICE.id,
    roles: ALICE.roles,
    text: 'gg',
    attachments: ['https://cdn.example/lobby.png'],
  },
  minutes(3),
);
check(
  'a lobby picture is refused with one line',
  posted.slice(before).some((p) => p.text.includes('not an end-of-game screen')),
  since(before),
);
check(
  'and the wait for the real one holds',
  state.wait?.event === 'attachment',
  JSON.stringify(state.wait),
);

// DEFEAT from a member of team A is a win for team B.
before = posted.length;
await feed(
  {
    kind: 'message',
    from: ALICE.id,
    roles: ALICE.roles,
    text: '',
    attachments: ['https://cdn.example/g1-defeat.png'],
  },
  minutes(4),
);
check(
  'a defeat posted by team A records a win for team B',
  posted
    .slice(before)
    .some((p) => p.text.includes('<@&role-b> wins') && p.text.includes('CEO 0 - 1 PPG')),
  since(before),
);
check(
  'the loser is asked for its side, as buttons',
  asked.at(-1)?.who.includes('role-a') === true &&
    asked.at(-1)?.question.includes('which side') === true,
  JSON.stringify(asked.at(-1)),
);
check(
  'Alice is now the reporter',
  state.variables.reporter === ALICE.id,
  String(state.variables.reporter),
);

// The wrong team cannot pick a side; the right one does.
const wrong = await feed(
  { kind: 'button', from: BOB.id, roles: BOB.roles, chose: 'Red' },
  minutes(5),
);
check(
  'a button from the winning team is refused',
  !wrong.taken && Boolean(wrong.say),
  wrong.say ?? '',
);
await feed({ kind: 'button', from: ANNE.id, roles: ANNE.roles, chose: 'Red' }, minutes(5));
check(
  'team A takes red for game 2',
  (state.variables.red as { name: string }).name === 'CEO' &&
    (state.variables.blue as { name: string }).name === 'PPG',
  JSON.stringify([state.variables.blue, state.variables.red]),
);
const links2 = posted.filter((p) => p.text.includes('📝 Game')).at(-1)?.text ?? '';
check(
  'game 2 links follow the new sides, on the same session',
  links2.includes('<@&role-b> blue: https://draft.example/session/draft-1/blue') &&
    links2.includes('<@&role-a> red: https://draft.example/session/draft-1/red'),
  links2,
);
const next = fetched.find((f) => f.op === 'next');
check(
  'the site was told who won game 1 and the sides for game 2, not asked for a new session',
  fetched.filter((f) => f.op === 'create').length === 1 &&
    next?.args.id === 'draft-1' &&
    next.args.winner === (blueFirst === 'role-b' ? 'blue' : 'red') &&
    next.args.blueTeam === 'PPG' &&
    next.args.redTeam === 'CEO',
  JSON.stringify(fetched.map((f) => `${f.op} ${JSON.stringify(f.args)}`)),
);

// The draft again, then a word from a team, then the screenshot.
for (let i = 0; state.wait?.kind === 'poll' && i < 20; i++)
  await feed({ kind: 'tick' }, minutes(6 + i));
check('game 2 draft finished', state.wait?.event === 'message', JSON.stringify(state.wait));
before = posted.length;
await feed(
  { kind: 'message', from: BOB.id, roles: BOB.roles, text: 'lobby is up', attachments: [] },
  minutes(7),
);
check(
  'a word from a team settles the check-in without a nudge',
  state.wait?.event === 'attachment' &&
    !posted.slice(before).some((p) => p.text.includes('Everything fine')),
  JSON.stringify(state.wait),
);
check(
  'only the reporter may send the screenshot now',
  state.wait?.from.length === 1 && state.wait.from[0] === ALICE.id,
  JSON.stringify(state.wait?.from),
);
const dup = await feed(
  {
    kind: 'message',
    from: ANNE.id,
    roles: ANNE.roles,
    text: '',
    attachments: ['https://cdn.example/g2-defeat.png'],
  },
  minutes(8),
);
check(
  'a screenshot from anyone else is refused as not the reporter',
  !dup.taken && (dup.say ?? '').includes('reporter'),
  dup.say ?? '',
);
before = posted.length;
await feed(
  {
    kind: 'message',
    from: ALICE.id,
    roles: ALICE.roles,
    text: '',
    attachments: ['https://cdn.example/g2-defeat.png'],
  },
  minutes(9),
);
check(
  'a second defeat from team A ends it 2-0 for team B',
  posted.slice(before).some((p) => p.text.includes('CEO 0 - 2 PPG')),
  since(before),
);
check(
  'gg is said',
  posted.some((p) => p.text.startsWith('gg.') && p.text.includes('<@&role-b>')),
  lastPost(),
);
const results = posted.find((p) => p.channel === 'channel-results');
check(
  'the results channel gets exactly WINNER 2-0 LOSER',
  results?.text === 'PPG 2-0 CEO',
  results?.text ?? '(nothing)',
);
check(
  'with the two stored screenshots and nothing else',
  results?.attachments?.length === 2 && results.attachments.every((a) => a.includes('defeat')),
  JSON.stringify(results?.attachments),
);
check('the run is done', state.done && !state.stoppedBecause, state.stoppedBecause ?? '');
check(
  'and the series was closed on the site with its winner',
  fetched.at(-1)?.op === 'finish' && fetched.at(-1)?.args.id === 'draft-1',
  JSON.stringify(fetched.at(-1)),
);

console.log(['', 'a series from the calendar waits for its hour'].join(String.fromCharCode(10)));
{
  resetDraftFixture();
  const kept = fetched.splice(0);
  const n = posted.length;
  const startAt = new Date('2026-09-12T19:00:00.000Z');
  const timed = await runWorkflow({
    guildId: '900000000000000001',
    workflow: BO3_SERIES,
    context: seriesContext({
      teamA: A,
      teamB: B,
      channel: 'channel-match',
      results: 'results',
      rules: '',
      mods: '@mods',
      startAt: startAt.toISOString(),
      startTime: '21:00 CEST',
      matchId: 'm-401',
      teamAId: 't-a',
      teamBId: 't-b',
    }),
    effects,
    allowedActions: [...WORKFLOW_ACTIONS],
    now: new Date('2026-09-12T14:00:00.000Z'),
  });
  check(
    'it greets the teams straight away',
    posted.slice(n).some((p) => p.text.includes('welcome to your best of three')),
    since(n),
  );
  check(
    'and says when the draft opens',
    posted.slice(n).some((p) => p.text.includes('21:00 CEST')),
    since(n),
  );
  check(
    'then waits on the clock',
    timed.state?.wait?.kind === 'clock',
    JSON.stringify(timed.state?.wait),
  );
  check(
    'with no coin flip yet',
    !posted.slice(n).some((p) => p.text.includes('Coin flip')),
    since(n),
  );
  let timedState = timed.state as RunState;
  const before = await resumeWorkflow(
    timedState,
    { kind: 'tick' },
    {
      guildId: '900000000000000001',
      effects,
      allowedActions: [...WORKFLOW_ACTIONS],
      now: new Date('2026-09-12T18:30:00.000Z'),
    },
  );
  check(
    'half an hour early, nothing happens',
    !before.taken || before.state.wait?.kind === 'clock',
  );
  if (before.taken) timedState = before.state;
  const m = posted.length;
  const after = await resumeWorkflow(
    timedState,
    { kind: 'tick' },
    {
      guildId: '900000000000000001',
      effects,
      allowedActions: [...WORKFLOW_ACTIONS],
      now: new Date('2026-09-12T19:00:30.000Z'),
    },
  );
  check(
    'at the hour the coin is flipped',
    after.taken && posted.slice(m).some((p) => p.text.includes('Coin flip')),
    since(m),
  );
  check(
    'and the draft links go out',
    posted.slice(m).some((p) => p.text.includes('📝 Game')),
    since(m),
  );
  fetched.splice(0, fetched.length, ...kept);
}

console.log(['', 'a run keeps the room it spoke in'].join(String.fromCharCode(10)));
{
  resetDraftFixture();
  const kept = fetched.splice(0);
  const rooming = await runWorkflow({
    guildId: '900000000000000001',
    workflow: {
      name: 'Rooming',
      trigger: { kind: 'request' },
      steps: [
        { type: 'do', action: 'post_message', with: { channel: 'channel-room', text: 'hello' } },
        {
          type: 'fetch',
          source: 'draft_flow',
          op: 'create',
          with: { blueTeam: 'A', redTeam: 'B', label: 'x' },
          as: 'draft',
        },
        {
          type: 'wait_until',
          source: 'draft_flow',
          op: 'state',
          with: { id: '{draft.id}' },
          as: 'draft',
          when: '{draft.status} == done',
          timeoutMinutes: 10,
          onTimeout: [],
        },
      ],
    },
    context: {},
    effects,
    allowedActions: [...WORKFLOW_ACTIONS],
    now: clock,
  });
  check(
    'while it polls a site it still knows its room',
    rooming.state?.variables._channel === 'channel-room',
    JSON.stringify(rooming.state?.variables._channel),
  );
  check('and its name', rooming.state?.workflowName === 'Rooming');
  fetched.splice(0, fetched.length, ...kept);
}

console.log(['', 'a series with what it needs missing'].join(String.fromCharCode(10)));
resetDraftFixture();
const plainContext = () =>
  seriesContext({
    teamA: A,
    teamB: B,
    channel: 'channel-match',
    results: 'results',
    rules: '',
    mods: '@mods',
  });
const noPost = await runWorkflow({
  guildId: '900000000000000001',
  workflow: BO3_SERIES,
  context: plainContext(),
  effects,
  allowedActions: ['ask_buttons'],
  now: clock,
});
check(
  'with post_message off it stops and names it',
  (noPost.stoppedBecause ?? '').includes('post_message'),
  noPost.stoppedBecause ?? '',
);
resetDraftFixture();
const noResults = await runWorkflow({
  guildId: '900000000000000001',
  workflow: { ...BO3_SERIES, steps: BO3_SERIES.steps.slice(-1) },
  context: {
    ...plainContext(),
    results: 'gone',
    champion: B,
    runnerUp: A,
    score: '2-0',
    shotList: 'x',
  },
  effects: {
    ...effects,
    async roomId(name: string) {
      return name === 'gone' ? null : name;
    },
  },
  allowedActions: [...WORKFLOW_ACTIONS],
  now: clock,
});
check(
  'with the results channel gone it stops and names it',
  (noResults.stoppedBecause ?? '').includes('gone'),
  noResults.stoppedBecause ?? '',
);

console.log(
  failed === 0 ? '\nthe workflow ran as written.' : `\n${failed} workflow check(s) failed.`,
);
if (failed > 0) process.exitCode = 1;
