// The match-day playbook, run against the fixture, on a Thursday.
//
// This needs no model and no Discord: the league is the fixture, the effects
// are refused, and the run is a dry run, so what is checked is the flow itself.
// The fixture's week-six matches fall on Thursday 10 September 2026, which is
// the day this runs; the Sunday after it has nothing, and a run on that day
// must do nothing rather than announce something it made up.
//
//   pnpm --filter @sentrybot/core eval:playbook

import process from 'node:process';
import { MATCH_DAY, matchDayContext } from './playbooks/match-day';
import { PLAYBOOK_ACTIONS, runPlaybook } from './playbooks';
import type { PlaybookEffects, RunResult } from './playbooks';

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
function refusing(calls: string[]): PlaybookEffects {
  return {
    async postMessage() {
      calls.push('postMessage');
    },
    async askButtons() {
      calls.push('askButtons');
    },
    async addReaction() {
      calls.push('addReaction');
    },
    async pinMessage() {
      calls.push('pinMessage');
    },
    async channelId(name) {
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

const thursday = await runPlaybook({
  guildId: '900000000000000001',
  playbook: MATCH_DAY,
  context: context as unknown as Record<string, unknown>,
  effects: refusing(calls),
  allowedActions: [...PLAYBOOK_ACTIONS],
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
const sunday = await runPlaybook({
  guildId: '900000000000000001',
  playbook: MATCH_DAY,
  context: quiet as unknown as Record<string, unknown>,
  effects: refusing(calls),
  allowedActions: [...PLAYBOOK_ACTIONS],
  dryRun: true,
  now: SUNDAY,
});
check('it finds nothing on', quiet.matches.length === 0);
check('and says nothing at all', sunday.entries.length === 0, said(sunday));

console.log(['', 'what an owner has not allowed'].join(String.fromCharCode(10)));
const locked = await runPlaybook({
  guildId: '900000000000000001',
  playbook: MATCH_DAY,
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
const noChannel = await runPlaybook({
  guildId: '900000000000000001',
  playbook: MATCH_DAY,
  context: context as unknown as Record<string, unknown>,
  effects: {
    ...refusing(calls),
    async channelId() {
      return null;
    },
  },
  allowedActions: [...PLAYBOOK_ACTIONS],
  now: THURSDAY,
});
check('a live run stops rather than guessing a channel', Boolean(noChannel.stoppedBecause));
check(
  'and names the channel it wanted',
  (noChannel.stoppedBecause ?? '').includes('match-info'),
  noChannel.stoppedBecause ?? '',
);

console.log(
  failed === 0 ? '\nthe playbook ran as written.' : `\n${failed} playbook check(s) failed.`,
);
if (failed > 0) process.exitCode = 1;
