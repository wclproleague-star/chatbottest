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

console.log(failed === 0 ? '\nall unit checks passed.' : `\n${failed} unit check(s) failed.`);
if (failed > 0) process.exitCode = 1;
