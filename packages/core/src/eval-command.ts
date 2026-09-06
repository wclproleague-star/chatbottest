// Command mode, against a server that only exists here.
//
// The plan is what matters: the right actions, the real names, and a question
// rather than a guess when something is missing. Nothing in this file touches
// Discord; the live half, creating the channel on the test server, is the last
// step of the eval in CLAUDE.md and is run by hand once.
//
//   pnpm --filter @kalvard/core eval:command

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
  modRole: { id: 'r3', name: 'Modérateur' },
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
    check('it says who cannot see it', /nobody else can|Everyone else keeps/i.test(said), said);
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
      async setPrivate({ roleIds }) {
        calls.push(`private for ${roleIds.join('+')}`);
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

console.log(['', 'who can see a new channel'].join(String.fromCharCode(10)));
{
  // Naming roles is how somebody says "these people, not everyone". A channel
  // made public because nobody asked the question is the failure that matters.
  const withRoles = await planCommand({
    guildId: '900000000000000001',
    request:
      'crée un channel #finale-wcl dans Compétition et mets les rôles Joueur et Caster dedans',
    by: MOD,
    shape: SHAPE,
  });
  const said = lines(withRoles);
  check('naming roles makes it private', said.includes('Only Joueur, Caster'), said);
  check(
    'and says everyone else cannot see it',
    /nobody else|everyone else cannot/i.test(said),
    said,
  );
  check(
    'the create step carries the roles, so it is never public for a moment',
    withRoles.kind === 'plan' && Boolean(withRoles.steps[0]?.args.roles),
    JSON.stringify(withRoles.kind === 'plan' ? withRoles.steps[0] : withRoles),
  );

  const noRoles = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #annonces-finale dans Communauté',
    by: MOD,
    shape: SHAPE,
  });
  const open = lines(noRoles);
  check('no roles named leaves it open', /everyone who can see/i.test(open), open);
  check('and it says so plainly', !open.includes('Only '), open);

  const explicit = await planCommand({
    guildId: '900000000000000001',
    request:
      'crée un channel public #finale-wcl dans Compétition, visible par tout le monde, et donne aux rôles Joueur et Caster le droit d écrire',
    by: MOD,
    shape: SHAPE,
  });
  const asked = lines(explicit);
  check('asking for public wins over the guess', /everyone who can see/i.test(asked), asked);
}

console.log(['', 'the moderators are never shut out'].join(String.fromCharCode(10)));
{
  const plan = await planCommand({
    guildId: '900000000000000001',
    request:
      'crée un channel #finale-wcl dans Compétition et mets les rôles Joueur et Caster dedans',
    by: MOD,
    shape: SHAPE,
  });
  const said = lines(plan);
  check('the mod role is in the sentence', said.includes('Modérateur'), said);
  check(
    'named after the roles that were asked for',
    /Joueur, Caster and Modérateur|Joueur and Caster and Modérateur/.test(said),
    said,
  );
  check(
    'and it is part of the creation, not added after',
    plan.kind === 'plan' && (plan.steps[0]?.args.roles ?? '').includes('Modérateur'),
    JSON.stringify(plan.kind === 'plan' ? plan.steps[0] : plan),
  );

  const noMods = await planCommand({
    guildId: '900000000000000001',
    request:
      'crée un channel #finale-wcl dans Compétition et mets les rôles Joueur et Caster dedans',
    by: MOD,
    shape: { ...SHAPE, modRole: undefined },
  });
  const quiet = lines(noMods);
  check(
    'a server with no mod role reads as before',
    quiet.includes('Only Joueur and Caster'),
    quiet,
  );

  const open = await planCommand({
    guildId: '900000000000000001',
    request: 'crée un channel #annonces dans Communauté',
    by: MOD,
    shape: SHAPE,
  });
  check(
    'a public channel says nothing about the mod role',
    !lines(open).includes('Modérateur'),
    lines(open),
  );
}

console.log(['', 'a moderator who is not asking for anything'].join(String.fromCharCode(10)));
{
  for (const greeting of ['hi bro', 'salut bg', 'ça va ?']) {
    const out = await planCommand({
      guildId: '900000000000000001',
      request: greeting,
      by: MOD,
      shape: SHAPE,
    });
    check(
      `"${greeting}" is not a command at all`,
      out.kind === 'not_a_command',
      `${out.kind}: ${'because' in out ? out.because : ''}`,
    );
  }

  // A real request that this server has switched off is still a refusal: the
  // two must not be told apart by reading the model's English.
  const off = await planCommand({
    guildId: '900000000000000001',
    request: 'archive #annonces',
    by: MOD,
    shape: { ...SHAPE, allowedActions: ['create_channel'] },
  });
  check('a switched-off action is still refused', off.kind === 'refused', off.kind);
}

console.log(['', 'giving somebody a role'].join(String.fromCharCode(10)));
{
  // What happened live: the plan came back with an empty role name, was shown
  // as "Give this guy the  role", and stopped on confirm. Whatever the model
  // returns, a plan must never carry a step with nothing to act on — that is
  // the invariant, and it does not depend on how the model felt that day.
  for (const request of [
    'give him the role',
    'donne lui le rôle',
    'this guy is indeed a part of the roster, give him the role',
  ]) {
    const out = await planCommand({
      guildId: '900000000000000001',
      request,
      by: MOD,
      shape: SHAPE,
    });
    const empty =
      out.kind === 'plan' &&
      out.steps.some(
        (step) =>
          step.action === 'assign_role' && (!step.args.roles?.trim() || !step.args.member?.trim()),
      );
    check(`"${request}" never plans an empty assignment`, !empty, JSON.stringify(out));
  }

  // A role named anywhere in the sentence is the role, and asking again for
  // something already said is how a bot wastes somebody's time.
  const named = await planCommand({
    guildId: '900000000000000001',
    request: 'PPG is part of Joueur, give PPG the role',
    by: MOD,
    shape: SHAPE,
  });
  // Either it plans it properly or it asks; what it may never do is plan a
  // sentence nobody can check.
  check(
    'a plan for an assignment is always readable',
    named.kind !== 'plan' ||
      named.steps.every(
        (step) =>
          step.action !== 'assign_role' ||
          (Boolean(step.args.roles?.trim()) &&
            Boolean(step.args.member?.trim()) &&
            (step.args.member ?? '').length < 60),
      ),
    JSON.stringify(named),
  );
}

console.log(failed === 0 ? '\ncommand mode plans as written.' : `\n${failed} check(s) failed.`);
if (failed > 0) process.exitCode = 1;
