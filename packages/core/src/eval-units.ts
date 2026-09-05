// The checks that need no model, no network and no database.
//
// Everything here is a defect that reached a member once: a bot answering
// twenty messages in half a minute, a three-thousand-character paste going to
// the model whole. They run in a second, so they run on every change.
//
//   pnpm --filter @sentrybot/core eval:units

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

console.log(failed === 0 ? '\nall unit checks passed.' : `\n${failed} unit check(s) failed.`);
if (failed > 0) process.exitCode = 1;
