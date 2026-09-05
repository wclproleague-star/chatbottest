// The checks that need no model, no network and no database.
//
// Everything here is a defect that reached a member once: a bot answering
// twenty messages in half a minute, a three-thousand-character paste going to
// the model whole. They run in a second, so they run on every change.
//
//   pnpm --filter @sentrybot/core eval:units

import process from 'node:process';
import { DEFAULT_LIMITS, allowMessage, forModel, forgetMember, parseLimits } from './limits';

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

console.log(failed === 0 ? '\nall unit checks passed.' : `\n${failed} unit check(s) failed.`);
if (failed > 0) process.exitCode = 1;
