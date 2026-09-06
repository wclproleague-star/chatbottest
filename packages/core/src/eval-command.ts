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

const { COMMAND_ACTIONS, describePlan, nameOf, planCommand, withAnswer } =
  await import('./command');
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

  // A moderator asking for a role for themselves is a member asking for a
  // role. Live, "give me ff role" from a staff member came back as the whole
  // role list read out, because the planner took it for an order about
  // somebody else. It goes down the funnel like anybody's request.
  for (const own of [
    'give me ff role',
    'donne moi le rôle Joueur',
    'can I have the Caster role?',
  ]) {
    const out = await planCommand({
      guildId: '900000000000000001',
      request: own,
      by: MOD,
      shape: SHAPE,
    });
    check(
      `"${own}" is for themselves, so it is not a command`,
      out.kind === 'not_a_command',
      `${out.kind}: ${'because' in out ? out.because : 'question' in out ? out.question : ''}`,
    );
  }

  // Whoever gets a role has to be somebody: a member found on Discord, or a
  // mention. Live, a plan read "Give no, fast forward role the Fast Forward
  // role", the member being the message itself. The name is resolved before
  // the plan is shown, and a name nobody answers to is a question.
  const whoIs = async (name: string) =>
    name.toLowerCase() === 'craig' || name === '4242' ? { id: '4242', name: 'Craig' } : null;
  const known = await planCommand({
    guildId: '900000000000000001',
    request: 'give Craig the Caster role',
    by: MOD,
    shape: SHAPE,
    whoIs,
  });
  check(
    'a member Discord knows is planned for',
    known.kind === 'plan',
    `${known.kind}: ${'question' in known ? known.because + ' ' + known.question : 'because' in known ? known.because : ''}`,
  );
  check(
    'by id, not by the words',
    known.kind === 'plan' && known.steps[0]?.args.member === '4242',
    known.kind === 'plan' ? JSON.stringify(known.steps[0]?.args) : '',
  );
  check(
    'and the sentence names them',
    known.kind === 'plan' && (known.steps[0]?.sentence.includes('Craig') ?? false),
    known.kind === 'plan' ? (known.steps[0]?.sentence ?? '') : '',
  );
  const mentioned = await planCommand({
    guildId: '900000000000000001',
    request: 'give <@4242> the Caster role',
    by: MOD,
    shape: SHAPE,
    whoIs,
  });
  check(
    'a mention is the member',
    mentioned.kind === 'plan' && mentioned.steps[0]?.args.member === '4242',
    `${mentioned.kind}: ${'question' in mentioned ? mentioned.because + ' ' + mentioned.question : 'because' in mentioned ? mentioned.because : JSON.stringify(mentioned.steps[0]?.args)}`,
  );
  const nobody = await planCommand({
    guildId: '900000000000000001',
    request: 'give Zorblax the Caster role',
    by: MOD,
    shape: SHAPE,
    whoIs,
  });
  check(
    'a name nobody answers to is a question, not a plan',
    nobody.kind === 'question',
    `${nobody.kind}: ${'question' in nobody ? nobody.question : ''}`,
  );

  // A moderator answering an escalation writes "give him the role": him is
  // the member who asked. Live, that sentence was filed as knowledge and read
  // back with "Got it. Next time I'll know." instead of being done.
  const him = await planCommand({
    guildId: '900000000000000001',
    request: "give him the Caster role, he's part of the roster",
    by: MOD,
    shape: SHAPE,
    whoIs,
    about: { id: '7777', name: 'kestrel' },
  });
  check(
    '"give him the role" is about the member who asked',
    him.kind === 'plan' && him.steps[0]?.args.member === '7777',
    `${him.kind}: ${'question' in him ? him.question : him.kind === 'plan' ? JSON.stringify(him.steps[0]?.args) : ''}`,
  );
  // "that role" is the role the escalation was about. Live, this reply was
  // filed as knowledge because nothing in it named a role.
  for (const reply of [
    "i confirm he's a part of the team, give him that role",
    'yes give it to him',
    'ok pour lui',
  ]) {
    const that = await planCommand({
      guildId: '900000000000000001',
      request: reply,
      by: MOD,
      shape: SHAPE,
      whoIs,
      about: { id: '7777', name: 'kestrel', role: { id: 'r2', name: 'Caster' } },
    });
    check(
      `"${reply}" gives the role the escalation was about`,
      that.kind === 'plan' &&
        that.steps.length === 1 &&
        that.steps[0]?.args.member === '7777' &&
        that.steps[0]?.args.roles === 'Caster',
      `${that.kind}: ${'question' in that ? that.question : 'because' in that ? that.because : JSON.stringify(that.steps)}`,
    );
  }
  const refusal = await planCommand({
    guildId: '900000000000000001',
    request: "no, he's not on the roster",
    by: MOD,
    shape: SHAPE,
    whoIs,
    about: { id: '7777', name: 'kestrel', role: { id: 'r2', name: 'Caster' } },
  });
  check(
    'a refusal gives nothing',
    refusal.kind !== 'plan',
    refusal.kind === 'plan' ? JSON.stringify(refusal.steps) : refusal.kind,
  );
  const named = await planCommand({
    guildId: '900000000000000001',
    request: 'give Craig the Caster role',
    by: MOD,
    shape: SHAPE,
    whoIs,
    about: { id: '7777', name: 'kestrel' },
  });
  check(
    'a name in the reply beats the member who asked',
    named.kind === 'plan' && named.steps[0]?.args.member === '4242',
    named.kind,
  );

  // The planner asked which category; the answer is the next message. Live,
  // "staff wcl" went to the answer loop instead and came back as a question
  // about a role called Tournaments Staff. The answer is folded into the
  // request, and a category written loosely is the category it names.
  const asked = await planCommand({
    guildId: '900000000000000001',
    request: 'create a channel called gros-pd that only Joueur can access',
    by: MOD,
    shape: SHAPE,
  });
  check('with no category it asks which', asked.kind === 'question', asked.kind);
  const answered = await planCommand({
    guildId: '900000000000000001',
    request: withAnswer(
      'create a channel called gros-pd that only Joueur can access',
      'competition',
      SHAPE,
    ),
    by: MOD,
    shape: SHAPE,
  });
  check(
    'the answer to the question completes the plan',
    answered.kind === 'plan' && answered.steps[0]?.args.category === 'Compétition',
    `${answered.kind}: ${'question' in answered ? answered.question : answered.kind === 'plan' ? JSON.stringify(answered.steps[0]?.args) : ''}`,
  );
  check(
    'a category written loosely is the one it names',
    nameOf('competition', SHAPE.categories) === 'Compétition' &&
      nameOf('staff wcl', [{ id: 'k9', name: 'WCL | Staff' }]) === 'WCL | Staff' &&
      nameOf('wcl', [
        { id: 'k9', name: 'WCL | Staff' },
        { id: 'k8', name: 'WCL | Logs' },
      ]) === null,
    `${nameOf('competition', SHAPE.categories)} / ${nameOf('staff wcl', [{ id: 'k9', name: 'WCL | Staff' }])}`,
  );

  // The ticket setup's own actions go through the same runner as everything
  // else: a category, a channel in it, the button message, and the choice
  // written down with what was made.
  {
    const { supportPlan } = await import('./support');
    const calls: string[] = [];
    const plan = supportPlan({
      mode: 'tickets',
      answers: {
        category: 'new:Tickets',
        buttonChannel: 'new:open-a-ticket',
        offerCategories: 'yes',
        ticketKinds: 'Question, Roles',
        humanRole: 'Modérateur',
      },
      shape: SHAPE,
    });
    const effects: CommandEffects = {
      async createChannel({ name, category }) {
        calls.push(`createChannel ${name} in ${category ?? '-'}`);
        return { id: 'chan-1', url: 'https://discord/chan-1' };
      },
      async allowRoles() {},
      async archiveChannel() {},
      async setPrivate() {},
      async postMessage() {
        return { url: 'x' };
      },
      async pinMessage() {},
      async assignRole() {},
      async createCategory({ name }) {
        calls.push(`createCategory ${name}`);
        return { id: 'cat-1' };
      },
      async postButton({ channelId, buttons }) {
        calls.push(`postButton in ${channelId}: ${buttons.map((b) => b.id).join('|')}`);
        return { url: 'https://discord/msg' };
      },
    };
    const done = await runPlan({
      guildId: '900000000000000001',
      commandId: '',
      plan: plan.steps,
      shape: SHAPE,
      effects,
    });
    check(
      'the ticket plan runs end to end',
      done.every((d) => d.ok),
      JSON.stringify(done.filter((d) => !d.ok)),
    );
    check(
      'category, then channel in it, then buttons on the new channel',
      calls.join(' / ') ===
        'createCategory Tickets / createChannel open-a-ticket in Tickets / postButton in chan-1: ticket:open:Question|ticket:open:Roles',
      calls.join(' / '),
    );
    const { loadSupport } = await import('./support');
    const saved = await loadSupport('900000000000000001');
    check(
      'and the choice is written down with what it made',
      saved.mode === 'tickets' &&
        saved.setup?.created.length === 2 &&
        saved.setup.humanRoleId === 'r3',
      JSON.stringify(saved),
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
