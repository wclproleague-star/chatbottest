// Command mode, against a server that only exists here.
//
// The plan is what matters: the right actions, the real names, and a question
// rather than a guess when something is missing. Nothing in this file touches
// Discord; the live half, creating the channel on the test server, is the last
// step of the eval in CLAUDE.md and is run by hand once.
//
//   pnpm --filter @sentrybot/core eval:command

import process from 'node:process';
import { fileURLToPath } from 'node:url';

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${f}`, import.meta.url)));
  } catch {
    // Not present.
  }
}

const { COMMAND_ACTIONS, describePlan, planCommand } = await import('./command');
const { runPlan } = await import('./command');
import type { CommandEffects, GuildShape, Plan } from './command';

const SHAPE: GuildShape = {
  channels: [
    { id: 'c1', name: 'annonces' },
    { id: 'c2', name: 'general' },
  ],
  categories: [
    { id: 'k1', name: 'Compétition' },
    { id: 'k2', name: 'Communauté' },
  ],
  roles: [
    { id: 'r1', name: 'Joueur' },
    { id: 'r2', name: 'Caster' },
    { id: 'r3', name: 'Modérateur' },
  ],
  allowedActions: [...COMMAND_ACTIONS],
};

const MOD = { id: '1002', name: 'PPG', isStaff: true, isOwner: false };
const MEMBER = { id: '5000', name: 'kestrel', isStaff: false, isOwner: false };

let failed = 0;
function check(what: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
}
const lines = (plan: Plan): string => describePlan(plan).join(' | ');

console.log(['', 'the request, with the category named'].join(String.fromCharCode(10)));
{
  const plan = await planCommand({
    guildId: '900000000000000001',
    request:
      'crée un channel #finale-wcl dans la catégorie Compétition et mets les rôles Joueur et Caster dedans',
    by: MOD,
    shape: SHAPE,
  });
  check('it made a plan', plan.kind === 'plan', JSON.stringify(plan));
  if (plan.kind === 'plan') {
    const said = lines(plan);
    check('it creates the channel', plan.steps[0]?.action === 'create_channel');
    check('with the name asked for', said.includes('#finale-wcl'), said);
    check('in the category asked for', said.includes('Compétition'), said);
    check(
      'and lets both roles in',
      plan.steps.some((s) => s.action === 'allow_roles'),
    );
    check('naming them exactly', said.includes('Joueur') && said.includes('Caster'), said);
    check('it says what happens to everyone else', said.includes('Everyone else keeps'), said);
    check('and nothing else', plan.steps.length === 2, String(plan.steps.length));
  }
}

console.log(['', 'the same request with no category'].join(String.fromCharCode(10)));
{
  const plan = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #finale-wcl et mets les rôles Joueur et Caster dedans',
    by: MOD,
    shape: SHAPE,
  });
  check('it asks rather than guessing', plan.kind === 'question', JSON.stringify(plan));
  if (plan.kind === 'question') {
    check('one question, about the category', /categor/i.test(plan.question), plan.question);
    check('and it lists the ones that exist', plan.question.includes('Compétition'), plan.question);
  }
}

console.log(['', 'a category that does not exist'].join(String.fromCharCode(10)));
{
  const plan = await planCommand({
    guildId: '900000000000000001',
    request: 'crée #finale-wcl dans la catégorie Playoffs',
    by: MOD,
    shape: SHAPE,
  });
  check('it asks', plan.kind === 'question', JSON.stringify(plan));
  if (plan.kind === 'question') {
    check('and says why', plan.because.includes('Playoffs'), plan.because);
  }
}

console.log(['', 'what a command may never do'].join(String.fromCharCode(10)));
{
  const deleting = await planCommand({
    guildId: '900000000000000001',
    request: 'supprime le channel #general',
    by: MOD,
    shape: SHAPE,
  });
  const said = deleting.kind === 'plan' ? lines(deleting) : '';
  check(
    'deleting becomes archiving',
    deleting.kind !== 'plan' || deleting.steps.every((s) => s.action !== 'create_channel'),
    said,
  );
  check(
    'and it says nothing is deleted',
    deleting.kind !== 'plan' || said.includes('nothing is deleted'),
    said,
  );

  const member = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #test dans Communauté',
    by: MEMBER,
    shape: SHAPE,
  });
  check('a member cannot command', member.kind === 'refused', JSON.stringify(member));

  const off = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #test dans Communauté',
    by: MOD,
    shape: { ...SHAPE, allowedActions: ['post_message'] },
  });
  check('an action the owner switched off is refused', off.kind === 'refused');
  check(
    'and it says which one',
    off.kind === 'refused' && off.because.includes('create channel'),
    off.kind === 'refused' ? off.because : '',
  );
}

console.log(['', 'confirming, against effects that only record'].join(String.fromCharCode(10)));
{
  const plan = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #finale-wcl dans Compétition et mets Joueur et Caster dedans',
    by: MOD,
    shape: SHAPE,
  });
  if (plan.kind !== 'plan') {
    check('it planned', false, JSON.stringify(plan));
  } else {
    const calls: string[] = [];
    const effects: CommandEffects = {
      async createChannel({ name, category }) {
        calls.push(`create ${name} in ${category}`);
        return { id: 'new-1', url: 'https://discord.com/channels/1/new-1' };
      },
      async allowRoles({ channelId, roleIds }) {
        calls.push(`allow ${roleIds.join('+')} in ${channelId}`);
      },
      async archiveChannel() {
        calls.push('archive');
      },
      async postMessage() {
        return { url: '' };
      },
      async pinMessage() {},
      async assignRole() {},
    };
    const done = await runPlan({
      guildId: '900000000000000001',
      commandId: '00000000-0000-4000-8000-0000000000ff',
      plan: plan.steps,
      shape: SHAPE,
      effects,
    });
    check(
      'every step ran',
      done.every((d) => d.ok),
      JSON.stringify(done),
    );
    check(
      'the channel was made first',
      Boolean(calls[0]?.startsWith('create finale-wcl')),
      calls.join(' | '),
    );
    check(
      'and the roles were put on the channel it just made',
      calls[1] === 'allow r1+r2 in new-1',
      calls.join(' | '),
    );
    check('the report carries a link', Boolean(done[0]?.link), JSON.stringify(done[0]));
  }
}

console.log(failed === 0 ? '\ncommand mode plans as written.' : `\n${failed} check(s) failed.`);
if (failed > 0) process.exitCode = 1;
