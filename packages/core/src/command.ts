// Command mode: say what you want, read what it will do, then decide.
//
// An owner or moderator writes a sentence. Kalvard turns it into a plan of
// allowlisted actions with the real names, roles and permissions filled in,
// asks one question when something it needs is missing, and then waits. Until
// somebody confirms, nothing has happened.
//
// Three rules hold the whole thing up. Only actions the owner has switched on,
// checked here rather than asked of the model. Nothing is ever deleted: the
// closest thing Kalvard does is archive, and a request to delete comes back as
// that. And every plan is written out in plain sentences with exact names, so
// confirming is a decision rather than a leap of faith.

import type { Json } from './database.types';
import { generateJson, Type } from './gemini';
import { serviceClient } from './supabase';

/** What a command may do. Anything else is refused before it reaches a plan. */
export const COMMAND_ACTIONS = [
  'create_channel',
  'allow_roles',
  'archive_channel',
  'set_private',
  'post_message',
  'pin_message',
  'assign_role',
] as const;
export type CommandAction = (typeof COMMAND_ACTIONS)[number];

/** One thing the plan will do, with the names already resolved. */
export type PlannedStep = {
  action: CommandAction;
  /** The values, as an owner would read them: names, not ids. */
  args: Record<string, string>;
  /** The same thing as one plain sentence. */
  sentence: string;
};

export type Plan =
  | { kind: 'plan'; steps: PlannedStep[]; touches: number }
  /** Something needed is missing, and one question settles it. */
  | { kind: 'question'; question: string; because: string }
  /** Nothing here is something Kalvard does. */
  | { kind: 'refused'; because: string };

/** What the guild actually has, so a plan can be checked against it. */
export type GuildShape = {
  channels: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  /** The actions this guild has switched on. */
  allowedActions: string[];
  /** The role Kalvard wakes. It is let into every private channel it makes. */
  modRole?: { id: string; name: string };
};

/** Who is asking. Only the owner and the mod role may command. */
export type Commander = { id: string; name: string; isStaff: boolean; isOwner: boolean };

export type ExecutedStep = { sentence: string; ok: boolean; detail: string; link?: string };

/** What a command may do in Discord. The bot supplies these; the web does not. */
export type CommandEffects = {
  createChannel(input: {
    name: string;
    category?: string;
    /** When set, @everyone cannot see it and only these roles can. */
    privateForRoleIds?: string[];
  }): Promise<{ id: string; url: string }>;
  allowRoles(input: { channelId: string; roleIds: string[] }): Promise<void>;
  archiveChannel(input: { channelId: string }): Promise<void>;
  /** Shuts everyone out of a channel that already exists, except these roles. */
  setPrivate(input: { channelId: string; roleIds: string[] }): Promise<void>;
  postMessage(input: { channelId: string; text: string }): Promise<{ url: string }>;
  pinMessage(input: { channelId: string; messageId: string }): Promise<void>;
  assignRole(input: { userId: string; roleId: string }): Promise<void>;
};

/** More than this and the plan is read out item by item before anything runs. */
export const ITEMISE_ABOVE = 3;

/**
 * Turns a request into a plan. The model proposes; everything that matters is
 * checked here: who is asking, what the guild allows, whether the names exist.
 */
export async function planCommand(input: {
  guildId: string;
  request: string;
  by: Commander;
  shape: GuildShape;
}): Promise<Plan> {
  if (!input.by.isOwner && !input.by.isStaff) {
    return {
      kind: 'refused',
      because: 'Only the owner and the moderators can ask Kalvard to change the server.',
    };
  }

  const raw = await propose(input.request, input.shape);
  if (raw.impossible.trim()) return { kind: 'refused', because: raw.impossible.trim() };

  const steps: PlannedStep[] = [];
  for (const step of raw.steps) {
    const action = step.action as CommandAction;
    if (!COMMAND_ACTIONS.includes(action)) {
      return { kind: 'refused', because: `Kalvard does not do "${step.action}".` };
    }
    if (!input.shape.allowedActions.includes(action)) {
      return {
        kind: 'refused',
        because: `${label(action)} is switched off for this server. Turn it on in Personality first.`,
      };
    }

    // A step with nothing to act on is not a step. The model proposes an empty
    // one now and again, and a plan that reads "create  in Compétition" is
    // worse than no plan at all.
    if (action === 'create_channel' && !clean(step.name ?? '')) continue;
    if (
      (action === 'allow_roles' || action === 'set_private' || action === 'archive_channel') &&
      !clean(step.channel ?? '')
    ) {
      continue;
    }

    // Names are checked against what the server has, not taken on trust.
    if (action === 'create_channel' && step.category) {
      const category = find(input.shape.categories, step.category);
      if (!category) {
        return {
          kind: 'question',
          because: `There is no category called "${step.category}".`,
          question: `Which category should ${hash(step.name ?? '')} go in? This server has: ${names(input.shape.categories)}.`,
        };
      }
      step.category = category.name;
    }
    if (action === 'create_channel' && !step.category && input.shape.categories.length > 0) {
      return {
        kind: 'question',
        because: 'The request does not say where the channel goes.',
        question: `Which category should ${hash(step.name ?? '')} go in? This server has: ${names(input.shape.categories)}.`,
      };
    }
    if (action === 'allow_roles' || action === 'assign_role' || action === 'set_private') {
      const wanted = (step.roles ?? []).map((r) => r.trim()).filter(Boolean);
      const missing = wanted.filter((r) => !find(input.shape.roles, r));
      if (missing.length > 0) {
        return {
          kind: 'question',
          because: `This server has no role called ${missing.map((m) => `"${m}"`).join(' or ')}.`,
          question: `Which role did you mean? This server has: ${names(input.shape.roles)}.`,
        };
      }
      step.roles = wanted.map((r) => find(input.shape.roles, r)!.name);
      const mods = input.shape.modRole?.name;
      if (action === 'set_private' && mods && !step.roles.includes(mods)) step.roles.push(mods);
    }

    steps.push({ action, args: argsOf(step), sentence: sentenceFor(action, step) });
  }

  // Who can see a new channel is not left to the model, and not left to
  // Discord's default either. Naming roles is how somebody says "these people";
  // a channel that comes out public because nobody asked is the whole problem.
  settleVisibility(steps, input.request, input.shape.modRole?.name);

  if (steps.length === 0) {
    return { kind: 'refused', because: 'Nothing in that is something Kalvard can do.' };
  }
  return { kind: 'plan', steps, touches: steps.length };
}

/**
 * Decides, and rewrites the sentences to say it. A request that names roles
 * for a channel it is creating means private: those roles and nobody else.
 * A request that names none is an announcement, and stays as open as the
 * category it sits in. Saying "public" or "privé" outright beats both.
 */
function settleVisibility(steps: PlannedStep[], request: string, modRole?: string): void {
  const saidPublic = /public|publique|tout le monde|everyone can see/i.test(request);
  const saidPrivate = /priv[eé]e?|private|only these|only them/i.test(request);

  for (const step of steps) {
    if (step.action !== 'create_channel') continue;
    const name = step.args.name ?? '';
    const roles = steps
      .filter((s) => s.action === 'allow_roles' && clean(s.args.channel ?? '') === clean(name))
      .flatMap((s) => (s.args.roles ?? '').split(',').map((r) => r.trim()))
      .filter(Boolean);

    const isPrivate = saidPrivate || (!saidPublic && roles.length > 0);
    step.args.visibility = isPrivate ? 'private' : 'public';
    if (isPrivate) {
      // The moderators are never shut out of a room in their own server, and
      // they are let in as it is made rather than added to it afterwards.
      const withMods = modRole && !roles.includes(modRole) ? [...roles, modRole] : roles;
      // The roles travel with the creation, so the channel is never public for
      // the moment between being made and being locked.
      step.args.roles = withMods.join(', ');
      step.sentence = `Create the text channel ${hash(name)}${step.args.category ? ` in ${step.args.category}` : ''}. Only ${list(withMods)} can see it; nobody else can.`;
    } else {
      step.sentence = `Create the text channel ${hash(name)}${step.args.category ? ` in ${step.args.category}` : ''}. Everyone who can see the category can see it.`;
    }

    // The follow-up reads differently once the channel is already private.
    for (const other of steps) {
      if (other.action !== 'allow_roles') continue;
      if (clean(other.args.channel ?? '') !== clean(name)) continue;
      other.sentence = isPrivate
        ? `Let ${roles.join(' and ')} write in ${hash(name)}.`
        : `Let ${roles.join(' and ')} see and write in ${hash(name)}. Everyone else keeps what they have.`;
    }
  }
}

type RawStep = {
  action: string;
  name?: string;
  category?: string;
  channel?: string;
  roles?: string[];
  text?: string;
  member?: string;
};

/** The model's proposal. It never acts; it only says what it would do. */
async function propose(
  request: string,
  shape: GuildShape,
): Promise<{ steps: RawStep[]; impossible: string }> {
  const out = await generateJson<{ steps: RawStep[]; impossible: string }>({
    system: [
      'You turn a moderator request into a plan for a Discord bot. You never carry anything out.',
      `The only actions are: create_channel (name, category), allow_roles (channel, roles), set_private (channel, roles: who keeps access), archive_channel (channel), post_message (channel, text), pin_message (channel), assign_role (member, roles).`,
      'Making an existing channel private, or hiding it from everyone but some roles, is set_private.',
      'Kalvard never deletes anything. A request to delete or remove a channel becomes archive_channel, and say so in impossible if that is not what they meant.',
      'Use the exact names the request uses. Do not invent a category, a role or a channel that was not asked for; leave the field empty and let the caller ask.',
      'impossible is one sentence, and only when nothing in the request is one of those actions. Otherwise it is empty.',
      `This server has these channels: ${names(shape.channels)}. Categories: ${names(shape.categories)}. Roles: ${names(shape.roles)}.`,
    ].join(' '),
    messages: [{ role: 'user', text: request }],
    schema: {
      type: Type.OBJECT,
      properties: {
        steps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: [...COMMAND_ACTIONS] },
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              channel: { type: Type.STRING },
              roles: { type: Type.ARRAY, items: { type: Type.STRING } },
              text: { type: Type.STRING },
              member: { type: Type.STRING },
            },
            required: ['action'],
            propertyOrdering: ['action', 'name', 'category', 'channel', 'roles', 'text', 'member'],
          },
        },
        impossible: { type: Type.STRING },
      },
      required: ['steps', 'impossible'],
      propertyOrdering: ['steps', 'impossible'],
    },
    temperature: 0,
  });
  return { steps: out.steps ?? [], impossible: out.impossible ?? '' };
}

/** The plan, as sentences somebody can check before they confirm. */
export function describePlan(plan: Plan): string[] {
  if (plan.kind !== 'plan') return [];
  return plan.steps.map((step) => step.sentence);
}

/** Runs a confirmed plan, in order, stopping at the first thing that fails. */
export async function runPlan(input: {
  guildId: string;
  commandId: string;
  plan: PlannedStep[];
  shape: GuildShape;
  effects: CommandEffects;
}): Promise<ExecutedStep[]> {
  const done: ExecutedStep[] = [];
  // A channel this plan just made, so a later step can point at it by name.
  const made = new Map<string, string>();

  for (const step of input.plan) {
    try {
      const detail = await carryOut(step, input, made);
      done.push({ sentence: step.sentence, ok: true, ...detail });
    } catch (err) {
      done.push({
        sentence: step.sentence,
        ok: false,
        detail: err instanceof Error ? err.message : 'It did not work.',
      });
      break;
    }
  }

  await serviceClient()
    .from('commands')
    .update({
      status: done.every((d) => d.ok) ? 'ran' : 'failed',
      ran: done as unknown as Json,
      ran_at: new Date().toISOString(),
    })
    .eq('id', input.commandId);
  return done;
}

async function carryOut(
  step: PlannedStep,
  input: { shape: GuildShape; effects: CommandEffects },
  made: Map<string, string>,
): Promise<{ detail: string; link?: string }> {
  const channelId = (name: string): string => {
    const known = made.get(clean(name)) ?? find(input.shape.channels, name)?.id;
    if (!known) throw new Error(`There is no channel called ${hash(name)} any more.`);
    return known;
  };

  switch (step.action) {
    case 'create_channel': {
      const roleIds =
        step.args.visibility === 'private'
          ? (step.args.roles ?? '')
              .split(',')
              .map((r) => find(input.shape.roles, r.trim())?.id)
              .filter((id): id is string => Boolean(id))
          : undefined;
      const created = await input.effects.createChannel({
        name: clean(step.args.name ?? ''),
        category: step.args.category,
        privateForRoleIds: roleIds,
      });
      made.set(clean(step.args.name ?? ''), created.id);
      const who = roleIds ? `, visible only to ${step.args.roles}` : ', visible to the category';
      return { detail: `Created ${hash(step.args.name ?? '')}${who}`, link: created.url };
    }
    case 'allow_roles': {
      const roleIds = (step.args.roles ?? '')
        .split(',')
        .map((r) => find(input.shape.roles, r.trim())?.id)
        .filter((id): id is string => Boolean(id));
      await input.effects.allowRoles({ channelId: channelId(step.args.channel ?? ''), roleIds });
      return { detail: `${step.args.roles} can see ${hash(step.args.channel ?? '')}` };
    }
    case 'set_private': {
      const roleIds = (step.args.roles ?? '')
        .split(',')
        .map((r) => find(input.shape.roles, r.trim())?.id)
        .filter((id): id is string => Boolean(id));
      await input.effects.setPrivate({ channelId: channelId(step.args.channel ?? ''), roleIds });
      return {
        detail: `${hash(step.args.channel ?? '')} is now visible only to ${step.args.roles}`,
      };
    }
    case 'archive_channel':
      await input.effects.archiveChannel({ channelId: channelId(step.args.channel ?? '') });
      return { detail: `Archived ${hash(step.args.channel ?? '')}, nothing was deleted` };
    case 'post_message': {
      const posted = await input.effects.postMessage({
        channelId: channelId(step.args.channel ?? ''),
        text: step.args.text ?? '',
      });
      return { detail: `Posted in ${hash(step.args.channel ?? '')}`, link: posted.url };
    }
    case 'pin_message':
      throw new Error('Pinning needs the message, so it is not something a command can do yet.');
    case 'assign_role': {
      const role = find(input.shape.roles, (step.args.roles ?? '').split(',')[0] ?? '');
      if (!role) throw new Error('That role is gone.');
      await input.effects.assignRole({ userId: step.args.member ?? '', roleId: role.id });
      return { detail: `Gave ${step.args.member} the ${role.name} role` };
    }
  }
}

/** Writes the command down before anything runs: who asked, and for what. */
export async function recordCommand(input: {
  guildId: string;
  by: Commander;
  request: string;
  plan: Plan;
}): Promise<string> {
  const { data } = await serviceClient()
    .from('commands')
    .insert({
      guild_id: input.guildId,
      asked_by: input.by.id,
      asked_by_name: input.by.name,
      request: input.request,
      plan: (input.plan.kind === 'plan' ? input.plan.steps : []) as unknown as Json,
      question: input.plan.kind === 'question' ? input.plan.question : null,
      status: input.plan.kind === 'plan' ? 'planned' : 'asked',
    })
    .select('id')
    .single();
  return data?.id ?? '';
}

/** Somebody said no. Nothing ran, and that is worth recording too. */
export async function cancelCommand(commandId: string): Promise<void> {
  await serviceClient().from('commands').update({ status: 'cancelled' }).eq('id', commandId);
}

function argsOf(step: RawStep): Record<string, string> {
  const args: Record<string, string> = {};
  if (step.name) args.name = clean(step.name);
  if (step.category) args.category = step.category;
  if (step.channel) args.channel = clean(step.channel);
  if (step.roles?.length) args.roles = step.roles.join(', ');
  if (step.text) args.text = step.text;
  if (step.member) args.member = step.member;
  return args;
}

/** One line an owner can check, with the real names in it. */
function sentenceFor(action: CommandAction, step: RawStep): string {
  const channel = hash(step.channel ?? step.name ?? '');
  switch (action) {
    case 'create_channel':
      return `Create the text channel ${hash(step.name ?? '')}${step.category ? ` in ${step.category}` : ''}.`;
    case 'allow_roles':
      return `Let ${(step.roles ?? []).join(' and ')} see and write in ${channel}. Everyone else keeps what they have.`;
    case 'set_private':
      return `Make ${channel} private: only ${(step.roles ?? []).join(' and ')} can see it, and nobody else.`;
    case 'archive_channel':
      return `Archive ${channel}: nobody can write in it, and nothing is deleted.`;
    case 'post_message':
      return `Post in ${channel}: "${(step.text ?? '').slice(0, 120)}".`;
    case 'pin_message':
      return `Pin the last message in ${channel}.`;
    case 'assign_role':
      return `Give ${step.member ?? 'them'} the ${(step.roles ?? []).join(' and ')} role.`;
  }
}

/** "a, b and c", which is how a person reads a list. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function label(action: CommandAction): string {
  return action.replace(/_/g, ' ');
}

/** Matches a name the way a person would: case and a leading # do not count. */
function find<T extends { name: string }>(list: T[], name: string): T | undefined {
  const wanted = clean(name);
  return list.find((item) => clean(item.name) === wanted);
}

/**
 * The accented letters a model actually hands back as named entities. It is
 * not the whole HTML table and does not need to be: these are the ones that
 * turn up in the names of channels, categories and roles.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  ouml: 'ö',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
};

function clean(name: string): string {
  // Models hand back "Comp&#233;tition" and "Comp&eacute;tition" for
  // "Compétition", and a category that exists must not look missing over an
  // encoding. Both spellings of an entity are decoded, numeric and named.
  const decoded = name
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, word: string) => NAMED[word.toLowerCase()] ?? whole);
  return decoded.trim().replace(/^#/, '').toLowerCase().normalize('NFC');
}

function hash(name: string): string {
  return `#${clean(name)}`;
}

function names(list: { name: string }[]): string {
  return list.length > 0 ? list.map((item) => item.name).join(', ') : 'none';
}
