// The checks that need no model, no network and no database.
//
// Everything here is a defect that reached a member once: a bot answering
// twenty messages in half a minute, a three-thousand-character paste going to
// the model whole. They run in a second, so they run on every change.
//
//   pnpm --filter @kalvard/core eval:units

import process from 'node:process';
import {
  DEFAULT_LIMITS,
  allowMessage,
  forModel,
  forgetMember,
  monthStart,
  parseLimits,
} from './limits';
import { backoffMs, classify, outageReply, worthRetrying } from './resilience';
import { AREAS, applyAnswer, decided, missing } from './onboard';
import { describeMatch, riftMatches, riftRoster } from './fetchers/rift-legends';
import { isPrivateHost, safeUrl } from './fetchers/http';
import { answersHere } from './answers-here';
import { whichRole } from './roles';
import { findRepeat, offer } from './repeats';
import { runWorkflow } from './workflows';
import { isDue, lastDue, readSchedule } from './schedule';
import { checkStep, readBack, whatChanged } from './workflow-author';
import type { RawStep } from './workflow-author';
import { summarise } from './fetchers/http-json';
import { fetchFrom } from './sources';
import { findPersonal, personalSummary } from './personal';
import { clockIn, inZone, pastRetention } from './times';

let failed = 0;

function check(what: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
}

console.log('\nrate limiting');
{
  const key = 'guild:member';
  forgetMember(key);
  const at = 1_000_000;
  const results = [];
  // Twenty messages in thirty seconds, the burst that started this.
  for (let i = 0; i < 20; i++) {
    results.push(allowMessage(key, DEFAULT_LIMITS, at + i * 1500));
  }
  const answered = results.filter((r) => r.allowed).length;
  check('the burst is cut off', answered <= DEFAULT_LIMITS.memberBurst, `answered ${answered}`);
  check('the member is told once, not every time', results.filter((r) => r.sayWhy).length === 1);
  const later = allowMessage(key, DEFAULT_LIMITS, at + 20 * 1500 + DEFAULT_LIMITS.memberCooldownMs);
  check('they are heard again after the cooldown', later.allowed);

  forgetMember(key);
  const spread = [0, 40_000, 80_000, 120_000].map(
    (offset) => allowMessage(key, DEFAULT_LIMITS, at + offset).allowed,
  );
  check('a slow conversation is never limited', spread.every(Boolean));

  forgetMember(key);
  const other = allowMessage('guild:someone-else', DEFAULT_LIMITS, at);
  check('one member does not silence another', other.allowed);
}

console.log('\nwhat the model is shown');
{
  const long = 'a'.repeat(3000);
  const shown = forModel(long);
  check('a long paste is cut', shown.length < long.length);
  check('the cut is marked', shown.includes('truncated'));
  check('it says how much was sent', shown.includes('3000'));
  check('a normal message is untouched', forModel('  when is my match?  ') === 'when is my match?');
}

console.log('\nlimits are settings, not constants');
{
  check(
    'nothing set means the defaults',
    parseLimits(null).memberBurst === DEFAULT_LIMITS.memberBurst,
  );
  check('an owner can raise the burst', parseLimits({ memberBurst: 40 }).memberBurst === 40);
  check(
    'nonsense falls back rather than breaking',
    parseLimits({ memberBurst: -3, maxMessageChars: 'lots' }).memberBurst ===
      DEFAULT_LIMITS.memberBurst,
  );
}

console.log('\nwhen a dependency fails');
{
  const cases: [unknown, string][] = [
    [Object.assign(new Error('rate limit exceeded'), { status: 429 }), 'rate_limited'],
    [new Error('The operation was aborted due to timeout'), 'timeout'],
    [Object.assign(new Error('Service Unavailable'), { status: 503 }), 'unavailable'],
    [new Error('fetch failed'), 'unavailable'],
    [Object.assign(new Error('Missing Permissions'), { status: 403 }), 'permission'],
    [Object.assign(new Error('Unknown Channel'), { status: 404 }), 'not_found'],
    [new Error('something odd'), 'unknown'],
  ];
  for (const [error, expected] of cases) {
    check(`${expected} is recognised`, classify(error) === expected, classify(error));
  }
  check('an outage is retried', worthRetrying('unavailable'));
  check('a missing permission is not retried', !worthRetrying('permission'));
  check('backoff grows', backoffMs(3, 400, () => 0.5) > backoffMs(1, 400, () => 0.5));
  check('backoff is jittered', backoffMs(2, 400, () => 0) !== backoffMs(2, 400, () => 1));
  const said = outageReply('unavailable');
  check('the member is told plainly', said.length > 0 && said.length < 120);
  check('no moderator is woken for an outage', !said.includes('{mods}'));
}

console.log('\ntimes');
{
  const instant = '2026-09-07T16:00:00.000Z';
  const paris = inZone(instant, 'Europe/Paris');
  const utc = inZone(instant, null);
  check('the same instant reads differently in two zones', paris !== utc, `${paris} vs ${utc}`);
  check('the guild timezone is used', paris.includes('18:00'), paris);
  check('a nonsense timezone still shows a time', clockIn(instant, 'Mars/Olympus').length > 0);
  check('nothing is shown for a broken date', inZone('not a date', null) === '');
  check('a guild still installed is never purged', !pastRetention(null));
  check(
    'thirty days after removal it is',
    pastRetention(new Date(Date.now() - 31 * 864e5).toISOString()),
  );
  check(
    'the day after removal it is not',
    !pastRetention(new Date(Date.now() - 864e5).toISOString()),
  );
}

console.log(['', 'personal details in the knowledge'].join(String.fromCharCode(10)));
{
  const roster = [
    'Team Baguette: captain kestrel, reach him on kestrel@example.com or +33 6 12 34 56 78.',
    'Substitutes meet at 12 Rue des Lilas before the match.',
  ].join(String.fromCharCode(10));
  const found = findPersonal(roster);
  const kinds = found.map((f) => f.kind);
  check('an email is found', kinds.includes('email'));
  check('a phone number is found', kinds.includes('phone'));
  check('a postal address is found', kinds.includes('address'));
  check('the owner is told what and why', personalSummary(found).includes('will not answer'));

  const schedule =
    'Fast Forward vs Baguette on Tuesday 8 September at 19:00 CET in #match-info, best of 3.';
  check('a schedule is not personal data', findPersonal(schedule).length === 0);
  check('nothing found means nothing said', personalSummary([]) === '');
  check(
    'a card number is reported as one',
    findPersonal('4111 1111 1111 1111').some((f) => f.kind === 'card'),
  );
  check('the same detail is not reported twice', findPersonal('a@b.com and a@b.com').length === 1);
}

console.log(['', 'what a guild may spend'].join(String.fromCharCode(10)));
{
  const limits = parseLimits({ monthlyAnswers: 5, maxDocumentChars: 1000, maxGuildChunks: 10 });
  check('a quota can be set', limits.monthlyAnswers === 5);
  check('a document cap can be set', limits.maxDocumentChars === 1000);
  check('a guild cap can be set', limits.maxGuildChunks === 10);
  check('the defaults are generous, not zero', DEFAULT_LIMITS.monthlyAnswers > 100);
  const start = monthStart(new Date('2026-09-17T13:45:00.000Z'));
  check(
    'the month starts at its first instant',
    start.toISOString() === '2026-09-01T00:00:00.000Z',
  );
  const january = monthStart(new Date('2026-01-01T00:00:00.000Z'));
  check(
    'the first of the month is its own start',
    january.toISOString() === '2026-01-01T00:00:00.000Z',
  );
}

console.log(['', 'setting a bot up'].join(String.fromCharCode(10)));
{
  // Five things, in order, because the beacon's slit lights a fifth per thing
  // decided: what an owner watches fill up is exactly what they have settled.
  check('it asks for the name first', missing({})[0] === 'botName');
  check('nothing decided lights nothing', decided({}) === 0);
  check(
    'the five are the five',
    AREAS.map((a) => a.key).join(',') === 'botName,personaPrompt,language,knowledge,scope',
  );

  const named = applyAnswer({}, 'botName', 'bogoss');
  check('a typed name is taken as the name', named.botName === 'bogoss');
  check('and lights one fifth', decided(named) === 1);

  const voiced = applyAnswer(named, 'personaPrompt', 'Funny but short. Esports server.');
  const spoken = applyAnswer(voiced, 'language', 'The language each member writes in');
  check('a picked language counts as answered', !missing(spoken).includes('language'));
  check('three decided lights three fifths', decided(spoken) === 3);

  const skipped = applyAnswer(spoken, 'knowledge', 'Not yet, I will add it later');
  check('putting knowledge off is still a decision', decided(skipped) === 4);
  check('and nothing was invented to fill it', (skipped.knowledge ?? []).length === 0);

  const paste = ['Match schedule', 'Tuesdays at 19:00 CET.'].join(String.fromCharCode(10));
  const pasted = applyAnswer(spoken, 'knowledge', paste);
  check('a paste becomes a document', (pasted.knowledge ?? []).length === 1);
  check('titled by its first line', pasted.knowledge?.[0]?.title === 'Match schedule');

  const open = applyAnswer(skipped, 'scope', 'Yes, general questions too');
  check('scope is answered', open.scope === 'open');
  check('and the slit is full', decided(open) === 5);
  check('nothing is left to ask', missing(open).length === 0);

  const shut = applyAnswer(skipped, 'scope', 'This server only');
  check('the other answer is heard too', shut.scope === 'server_only');

  const renamed = applyAnswer(open, 'botName', 'ignored');
  check('the name is not overwritten once given', renamed.botName === 'bogoss');

  const topics = applyAnswer({}, 'forbiddenTopics', 'bans and appeals');
  check('a picked topic is kept', (topics.forbiddenTopics ?? []).includes('bans and appeals'));
  const none = applyAnswer({}, 'forbiddenTopics', 'Nothing, it can answer anything it knows');
  check('choosing nothing forbidden forbids nothing', (none.forbiddenTopics ?? []).length === 0);
}

console.log(['', 'what a guild may spend'].join(String.fromCharCode(10)));
{
  const limits = parseLimits({ monthlyAnswers: 5, maxDocumentChars: 1000, maxGuildChunks: 10 });
  check('a quota can be set', limits.monthlyAnswers === 5);
  check('a document cap can be set', limits.maxDocumentChars === 1000);
  check('a guild cap can be set', limits.maxGuildChunks === 10);
  check('the defaults are generous, not zero', DEFAULT_LIMITS.monthlyAnswers > 100);
  const start = monthStart(new Date('2026-09-17T13:45:00.000Z'));
  check(
    'the month starts at its first instant',
    start.toISOString() === '2026-09-01T00:00:00.000Z',
  );
  const january = monthStart(new Date('2026-01-01T00:00:00.000Z'));
  check(
    'the first of the month is its own start',
    january.toISOString() === '2026-01-01T00:00:00.000Z',
  );
}

console.log(['', 'what a source may be pointed at'].join(String.fromCharCode(10)));
{
  for (const host of [
    'localhost',
    '127.0.0.1',
    '10.0.0.4',
    '192.168.1.20',
    '172.16.4.4',
    '169.254.169.254',
    'db.internal',
  ]) {
    check(`${host} is refused`, isPrivateHost(host));
  }
  check('a real host is allowed', !isPrivateHost('api.riftlegends.gg'));

  const refuses = (url: string): string => {
    try {
      safeUrl(url);
      return '';
    } catch (err) {
      return err instanceof Error ? err.message : 'refused';
    }
  };
  check('http is refused', refuses('http://api.riftlegends.gg/matches') !== '');
  check('a password in the address is refused', refuses('https://a:b@x.gg/') !== '');
  check('a private address is refused', refuses('https://10.1.2.3/matches') !== '');
  check('a plain https address is allowed', refuses('https://api.riftlegends.gg/matches') === '');
}

console.log(['', 'the league fixture'].join(String.fromCharCode(10)));
{
  const source = {
    id: 'league',
    name: 'the league schedule',
    answers: 'fixtures, times, results and rosters',
    kind: 'rift_legends',
    config: { baseUrl: 'fixture:rift-legends' },
  };
  const matches = await riftMatches(source);
  check('the fixture has matches', matches.length >= 3);
  check(
    'a match reads as a sentence',
    describeMatch(matches[0]!).includes('vs') && describeMatch(matches[0]!).includes('best of'),
  );
  const played = matches.find((m) => m.status === 'done');
  check('a played match shows its score', describeMatch(played!).includes('2-1'));

  const roster = await riftRoster(source, 't-ff');
  check('a roster comes back', (roster?.players.length ?? 0) === 3);
  check(
    'the captain is marked',
    (roster?.players ?? []).some((p) => p.isCaptain && p.handle === 'kestrel'),
  );

  const said = (await fetchFrom([source], 'league', 'who plays for Baguette?', 'g')) ?? '';
  check('asking who plays brings the roster', said.includes('brioche'));
  const quiet = (await fetchFrom([source], 'league', 'when do we play next?', 'g')) ?? '';
  check('asking the schedule does not', !quiet.includes('brioche'));
  check(
    'and no Discord id ever reaches a member',
    !said.includes('2001') && !quiet.includes('2001'),
  );
}

console.log(['', 'any JSON address'].join(String.fromCharCode(10)));
{
  const lines = summarise({
    league: { name: 'Rift Legends', season: 3 },
    matches: [
      { id: 'm1', time: '19:00', teams: ['FF', 'BAG'] },
      { id: 'm2', time: '21:00', teams: ['CN', 'KITE'] },
    ],
    nothing: null,
  });
  const said = lines.join(String.fromCharCode(10));
  check('a nested value keeps its path', said.includes('league.name: Rift Legends'), said);
  check('array items keep their index', said.includes('matches.0.time: 19:00'), said);
  check('and are never merged', said.includes('matches.1.time: 21:00'), said);
  check('nothing is left as nothing', !said.includes('nothing'), said);
  check(
    'a long list says how long it is',
    summarise({ xs: Array.from({ length: 30 }, (_, i) => i) }).some((l) => l.includes('30 items')),
  );
}

console.log(['', 'writing a workflow by describing it'].join(String.fromCharCode(10)));
{
  const shape = {
    channels: [{ id: '1', name: 'match-info' }],
    roles: [{ id: '10', name: 'Captain' }],
    allowedActions: ['post_message', 'ask_buttons'],
  };
  const asked = (raw: RawStep) => {
    const out = checkStep(raw, shape);
    return 'kind' in out ? out.question : '';
  };

  // The four things somebody describing a routine never says, and every one of
  // them decides whether the flow moves again.
  check(
    'a wait with nobody named asks who may satisfy it',
    asked({ type: 'wait_for', event: 'attachment', timeoutMinutes: 30 }).includes('satisfy'),
  );
  check(
    'a wait with no timeout asks how long',
    asked({ type: 'wait_for', event: 'attachment', from: 'either captain' }).includes('How long'),
  );
  check(
    'a timeout with nothing to do asks what happens',
    asked({
      type: 'wait_for',
      event: 'attachment',
      from: 'either captain',
      timeoutMinutes: 30,
    }).includes('time runs out'),
  );
  check(
    'a question with no buttons asks for them',
    asked({ type: 'ask', question: 'Which side?', of: 'the losing captain' }).includes('buttons'),
  );
  check(
    'a question put to nobody asks who',
    asked({ type: 'ask', question: 'Which side?', options: ['Blue', 'Red'] }).includes(
      'Who should be asked',
    ),
  );
  check(
    'a coin flip that says nothing is asked to say it',
    asked({ type: 'pick', options: ['Blue', 'Red'] }).includes('landed on'),
  );

  // The allowlist is code, not prompt.
  check(
    'an action this server has switched off is refused by name',
    asked({ type: 'do', action: 'pin_message', with: [] }).includes('pin message'),
  );
  const complete = checkStep(
    {
      type: 'wait_for',
      event: 'attachment',
      from: 'either captain',
      in: '#match-info',
      timeoutMinutes: 30,
      onTimeout: [
        { type: 'do', action: 'post_message', with: [{ key: 'text', value: 'Screenshot?' }] },
      ],
    },
    shape,
  );
  check('a complete wait compiles', 'step' in complete && complete.step?.type === 'wait_for');

  // A flow is approved by reading it, not by parsing it.
  const flow = {
    name: 'Best of three',
    trigger: { kind: 'request' as const },
    steps: [
      { type: 'pick' as const, from: ['Blue', 'Red'], announce: '#match-info', as: 'side' },
      {
        type: 'ask' as const,
        question: 'Which side?',
        options: ['Blue', 'Red'],
        of: 'the losing captain',
        as: 'side2',
      },
    ],
  };
  const lines = readBack(flow);
  check(
    'the read-back names the choice',
    Boolean(lines[0]?.includes('Pick one of Blue, Red')),
    lines[0],
  );
  check('and who is asked what', Boolean(lines[1]?.includes('Ask the losing captain')), lines[1]);
  const after = { ...flow, steps: [flow.steps[0]!] };
  const diff = whatChanged(flow, after);
  check(
    'an edit reads back only what changed',
    diff.length === 1 && diff[0]!.startsWith('Removed: Ask'),
    diff.join(' | '),
  );
}

console.log(['', 'when a scheduled workflow is due'].join(String.fromCharCode(10)));
{
  const paris = 'Europe/Paris';
  // A Thursday in September, 18:30 Paris time, so 18:00 has just gone.
  const thursdayEvening = new Date('2026-09-03T16:30:00Z');
  const due = lastDue('every Thursday at 18:00', thursdayEvening, paris);
  check(
    'a weekly schedule finds this evening',
    due?.toISOString() === '2026-09-03T16:00:00.000Z',
    String(due),
  );

  // Ten minutes before it, the most recent one is last week's.
  const beforeIt = new Date('2026-09-03T15:50:00Z');
  const earlier = lastDue('every Thursday at 18:00', beforeIt, paris);
  check(
    'and before the hour it finds the week before',
    earlier?.toISOString() === '2026-08-27T16:00:00.000Z',
    String(earlier),
  );

  check(
    'a daily schedule reads too',
    lastDue('every day at 09:00', new Date('2026-09-03T10:00:00Z'), paris)?.toISOString() ===
      '2026-09-03T07:00:00.000Z',
  );

  // Never guessed at: a phrase this does not understand does not run.
  check(
    'a phrase with no time is not a schedule',
    lastDue('when the season starts', thursdayEvening, paris) === null,
  );
  check('nor is an impossible hour', readSchedule('every day at 25:00') === null);

  // A run that already happened for that moment does not happen twice.
  const already = isDue({
    when: 'every Thursday at 18:00',
    now: thursdayEvening,
    timezone: paris,
    lastRun: '2026-09-03T16:00:05.000Z',
  });
  check('a workflow that already ran for that moment is not due again', already.due === false);
  const notYet = isDue({
    when: 'every Thursday at 18:00',
    now: thursdayEvening,
    timezone: paris,
    lastRun: '2026-08-27T16:00:05.000Z',
  });
  check('but last week does not count as this week', notYet.due === true);

  // A routine written this afternoon did not exist at yesterday's slot, and
  // must not fire for it the moment it is saved.
  const justWritten = isDue({
    when: 'every day at 17:45',
    now: new Date('2026-09-03T15:30:00Z'),
    timezone: paris,
    lastRun: null,
    createdAt: '2026-09-03T15:29:00Z',
  });
  check(
    'a workflow does not run for a slot that passed before it existed',
    justWritten.due === false,
  );
  const oldEnough = isDue({
    when: 'every day at 17:45',
    now: new Date('2026-09-03T15:30:00Z'),
    timezone: paris,
    lastRun: null,
    createdAt: '2026-09-01T09:00:00Z',
  });
  check('and one written last week still runs for yesterday', oldEnough.due === true);
}

console.log(['', 'noticing a routine somebody already keeps'].join(String.fromCharCode(10)));
{
  const paris = 'Europe/Paris';
  const thursdays = [
    { at: '2026-08-27T17:00:00Z', actions: ['create_channel', 'allow_roles'] },
    { at: '2026-09-03T17:00:00Z', actions: ['create_channel', 'allow_roles'] },
  ];
  const found = findRepeat(thursdays, paris);
  check(
    'two days with the same pair is a routine',
    found?.actions.length === 2,
    JSON.stringify(found),
  );
  check('and it says which day it lands on', found?.weekday === 'Thursday', String(found?.weekday));
  check(
    'the offer is in words, not actions',
    offer(found!).includes('create a channel, then let roles into it'),
  );

  // Twice in ten minutes is fixing a mistake, not keeping a routine.
  const sameDay = [
    { at: '2026-09-03T17:00:00Z', actions: ['create_channel', 'allow_roles'] },
    { at: '2026-09-03T17:10:00Z', actions: ['create_channel', 'allow_roles'] },
  ];
  check('the same day twice is not a routine', findRepeat(sameDay, paris) === null);

  // One action is not a sequence.
  const single = [
    { at: '2026-08-27T17:00:00Z', actions: ['post_message'] },
    { at: '2026-09-03T17:00:00Z', actions: ['post_message'] },
  ];
  check('one action on its own is not a routine', findRepeat(single, paris) === null);

  // The longest run wins, so the pair inside a triple is not offered as well.
  const triples = [
    { at: '2026-08-27T17:00:00Z', actions: ['create_channel', 'allow_roles', 'post_message'] },
    { at: '2026-09-03T17:00:00Z', actions: ['create_channel', 'allow_roles', 'post_message'] },
  ];
  check('the longest run is the one offered', findRepeat(triples, paris)?.actions.length === 3);

  // Different days of the week: still a routine, just not a weekly one.
  const scattered = [
    { at: '2026-08-25T17:00:00Z', actions: ['create_channel', 'allow_roles'] },
    { at: '2026-09-03T17:00:00Z', actions: ['create_channel', 'allow_roles'] },
  ];
  check(
    'a routine on different weekdays names no day',
    findRepeat(scattered, paris)?.weekday === undefined,
  );
}

console.log(['', 'the allowlist holds for every kind of step'].join(String.fromCharCode(10)));
{
  const posted: string[] = [];
  const asked: string[] = [];
  const effects = {
    async postMessage(_channelId: string, text: string) {
      posted.push(text);
    },
    async askButtons(input: { question: string }) {
      asked.push(input.question);
    },
    async addReaction() {},
    async pinMessage() {},
    async channelId(name: string) {
      return name;
    },
  };

  // A server that has not switched buttons on does not get buttons.
  const noButtons = await runWorkflow({
    guildId: 'g',
    workflow: {
      name: 'Ask',
      trigger: { kind: 'request' },
      steps: [
        {
          type: 'ask',
          question: 'Ready?',
          options: ['Yes', 'No'],
          of: 'the captains',
          in: 'test',
          as: 'ready',
        },
      ],
    },
    context: {},
    effects,
    allowedActions: ['post_message'],
  });
  check(
    'asking with buttons is refused when the action is off',
    Boolean(noButtons.stoppedBecause?.includes('ask_buttons')),
    String(noButtons.stoppedBecause),
  );
  check('and nothing was asked', asked.length === 0);

  // A coin flip is announced where people can see it, not only in the summary.
  const flip = await runWorkflow({
    guildId: 'g',
    workflow: {
      name: 'Flip',
      trigger: { kind: 'request' },
      steps: [
        {
          type: 'pick',
          from: ['Blue', 'Red'],
          announce: 'Coin flip: {side} picks first.',
          in: 'test',
          as: 'side',
        },
      ],
    },
    context: {},
    effects,
    allowedActions: ['post_message'],
  });
  check(
    'a coin flip reaches the channel',
    posted.some((t) => t.startsWith('Coin flip:')),
    posted.join(' | '),
  );
  check('and says what it landed on', /Blue|Red/.test(posted.join(' ')), posted.join(' | '));
  check('the run did not stop', !flip.stoppedBecause, String(flip.stoppedBecause));
}

console.log(['', 'where Kalvard will answer'].join(String.fromCharCode(10)));
{
  const staff = '1',
    test = '2';
  check(
    'with no list set, it answers anywhere it is named',
    answersHere({ allowedChannelIds: [], channelId: test, spokenHere: false }),
  );
  check(
    'inside the list it answers',
    answersHere({ allowedChannelIds: [staff], channelId: staff, spokenHere: false }),
  );
  check(
    'outside the list it stays quiet',
    !answersHere({ allowedChannelIds: [staff], channelId: test, spokenHere: false }),
  );
  // The one that matters: a workflow posts where the owner wrote it, and a bot
  // that speaks in a channel has to answer in it.
  check(
    'unless it has spoken there itself',
    answersHere({ allowedChannelIds: [staff], channelId: test, spokenHere: true }),
  );
}

console.log(
  ['', 'a role the server has but Kalvard does not hand out'].join(String.fromCharCode(10)),
);
{
  const selfServe = [
    { id: '1', name: 'Fast Forward Test' },
    { id: '2', name: 'Chromanova Test' },
  ];
  const all = [...selfServe, { id: '3', name: 'TTK' }, { id: '4', name: 'Modérateur' }];

  check(
    'a role it hands out is its own to give',
    whichRole('give me fast forward test', selfServe, all).kind === 'self_serve',
  );
  // The one that was wrong live: TTK exists on the server, so saying "that is
  // not something I do" is false. It is something somebody does.
  const ttk = whichRole('hum give me ttk role', selfServe, all);
  check('a real role it does not hand out is known to exist', ttk.kind === 'not_mine', ttk.kind);
  check('and it is named', ttk.kind === 'not_mine' && ttk.role.name === 'TTK');
  check(
    'a role the server does not have is unknown',
    whichRole('give me the admin role', selfServe, all).kind === 'unknown',
  );
  // Two roles named at once is not one request.
  check(
    'naming two is not a request for either',
    whichRole('ttk or fast forward test?', selfServe, all).kind === 'unknown',
  );
}

console.log(failed === 0 ? '\nall unit checks passed.' : `\n${failed} unit check(s) failed.`);
if (failed > 0) process.exitCode = 1;
