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
import { recordVouch } from './vouch-store';
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

/**
 * Actions only the support setup plans, never the model: a category, a
 * message carrying buttons, and the choice itself written down. They go
 * through the same confirmation and the same runner as everything else.
 */
export const SUPPORT_ACTIONS = ['create_category', 'post_button', 'set_support'] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

/** One thing the plan will do, with the names already resolved. */
export type PlannedStep = {
  action: CommandAction | SupportAction;
  /** The values, as an owner would read them: names, not ids. */
  args: Record<string, string>;
  /** The same thing as one plain sentence. */
  sentence: string;
};

export type Plan =
  | { kind: 'plan'; steps: PlannedStep[]; touches: number }
  /** Something needed is missing, and one question settles it. */
  | { kind: 'question'; question: string; because: string }
  /**
   * Not a request to change anything: a greeting, a question, a conversation.
   * The caller lets the answer loop have it. This is decided here rather than
   * by reading the model's English, which is written afresh every time and in
   * whichever language the member used.
   */
  | { kind: 'not_a_command'; because: string }
  /** A change Kalvard will not make: not allowed, not permitted, not ever. */
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
  /** A category, for the ticket system. */
  createCategory?(input: { name: string }): Promise<{ id: string }>;
  /** A message with buttons, each with an id the bot answers to. */
  postButton?(input: {
    channelId: string;
    text: string;
    buttons: { id: string; label: string }[];
  }): Promise<{ url: string }>;
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
  /**
   * Who a name or a mention id refers to on this server, from Discord. Without
   * it only a mention can name a member, because a plan that gives a role to
   * "whoever the model wrote in that field" is not a plan anybody can check.
   */
  whoIs?: (nameOrId: string) => Promise<{ id: string; name: string } | null>;
  /**
   * The member this request is about when it names nobody: a moderator
   * answering "give him the role" means the member who asked.
   */
  about?: { id: string; name: string; role?: { id: string; name: string } };
}): Promise<Plan> {
  if (!input.by.isOwner && !input.by.isStaff) {
    return {
      kind: 'refused',
      because: 'Only the owner and the moderators can ask Kalvard to change the server.',
    };
  }

  // A moderator is a member too. "give me the X role" is them asking for a
  // role, not ordering one for somebody else, and it takes the same path as
  // anybody's request: the proof, the role, or the moderators. Decided before
  // the model is asked, because the model reads "give me" as an instruction.
  if (forThemselves(input.request)) {
    return { kind: 'not_a_command', because: 'They are asking for themselves.' };
  }

  // A moderator answering an escalation about one role, for one member, does
  // not have to spell either out: "yes give it to him", "ok pour lui", "i
  // confirm, give him that role" all mean the same thing, and it is decided
  // here rather than asked of a model that reads "that role" as no role. A
  // refusal, or a reply that names some other role or person, goes the long
  // way round like any other request.
  if (input.about?.role && goesAhead(input.request)) {
    const others = input.shape.roles.filter(
      (r) => r.id !== input.about!.role!.id && clean(input.request).includes(clean(r.name)),
    );
    if (others.length === 0 && mentionsIn(input.request).length === 0) {
      const step: RawStep = {
        action: 'assign_role',
        roles: [input.about.role.name],
        member: input.about.id,
        memberName: input.about.name,
      };
      if (!input.shape.allowedActions.includes('assign_role')) {
        return {
          kind: 'refused',
          because: `${label('assign_role')} is switched off for this server. Turn it on in Personality first.`,
        };
      }
      return {
        kind: 'plan',
        steps: [
          { action: 'assign_role', args: argsOf(step), sentence: sentenceFor('assign_role', step) },
        ],
        touches: 1,
      };
    }
  }

  const raw = await propose(input.request, input.shape);
  // The model's own signal that nothing here is an action at all.
  if (raw.impossible.trim()) return { kind: 'not_a_command', because: raw.impossible.trim() };

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
    if (action === 'assign_role') {
      // Who gets it is never the model's to write: given the field, it hands
      // back a sentence, a made-up surname, or two hundred digits. The member
      // is read from the request in code. A mention is the member; otherwise
      // every word that is not a role, an action or filler is tried against
      // the server, and the first one somebody answers to wins. Discord is the
      // truth about who is here, so a name nobody answers to is a question.
      const mentioned = mentionsIn(input.request);
      if (mentioned.length > 1) {
        return {
          kind: 'question',
          because: 'The request mentions more than one person.',
          question: 'Who should get it? Mention them, one person at a time.',
        };
      }
      let found: { id: string; name: string } | null = null;
      if (mentioned.length === 1) {
        found = (await input.whoIs?.(mentioned[0]!)) ?? { id: mentioned[0]!, name: mentioned[0]! };
      } else if (input.whoIs) {
        for (const word of memberCandidates(input.request, input.shape.roles)) {
          found = await input.whoIs(word);
          if (found) break;
        }
      }
      if (!found && input.about) found = input.about;
      if (!found) {
        return {
          kind: 'question',
          because: input.whoIs
            ? 'I could not tell who gets the role.'
            : 'The request does not say who gets the role.',
          question: 'Who should it go to? Mention them.',
        };
      }
      step.member = found.id;
      step.memberName = found.name;

      // The role is often in the sentence even when the model left the field
      // empty. Reading it back out of the request beats asking for something
      // that was already said.
      if ((step.roles ?? []).filter((r) => r.trim()).length === 0) {
        const inText = input.shape.roles.filter((role) =>
          clean(input.request).includes(clean(role.name)),
        );
        if (inText.length === 1) step.roles = [inText[0]!.name];
        else if (inText.length === 0 && input.about?.role) step.roles = [input.about.role.name];
        else {
          return {
            kind: 'question',
            because: 'The request does not say which role.',
            question: `Which role should they get? This server has: ${names(input.shape.roles)}.`,
          };
        }
      }
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
    return { kind: 'not_a_command', because: 'Nothing in that asks for a change.' };
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
  memberName?: string;
};

/** The model's proposal. It never acts; it only says what it would do. */
async function propose(
  request: string,
  shape: GuildShape,
): Promise<{ steps: RawStep[]; impossible: string }> {
  let out: { steps?: RawStep[]; impossible?: string };
  try {
    out = await proposal(request, shape);
  } catch (err) {
    // A model that ran away or came back empty has not proposed anything.
    // Nothing is planned from junk; the moderator is asked to say it again.
    console.error(`kalvard: the planner did not answer: ${String(err)}`);
    return { steps: [], impossible: 'I could not make sense of that. Say it again, differently.' };
  }
  return { steps: out.steps ?? [], impossible: out.impossible ?? '' };
}

async function proposal(
  request: string,
  shape: GuildShape,
): Promise<{ steps?: RawStep[]; impossible?: string }> {
  return generateJson<{ steps: RawStep[]; impossible: string }>({
    system: [
      'You turn a moderator request into a plan for a Discord bot. You never carry anything out.',
      `The only actions are: create_channel (name, category), allow_roles (channel, roles), set_private (channel, roles: who keeps access), archive_channel (channel), post_message (channel, text), pin_message (channel), assign_role (roles).`,
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
            },
            required: ['action'],
            propertyOrdering: ['action', 'name', 'category', 'channel', 'roles', 'text'],
          },
        },
        impossible: { type: Type.STRING },
      },
      required: ['steps', 'impossible'],
      propertyOrdering: ['steps', 'impossible'],
    },
    temperature: 0,
    maxOutputTokens: 1024,
  });
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
  /** Who confirmed it, so a vouch says whose word it was. */
  by?: { name: string };
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
  input: { guildId: string; shape: GuildShape; effects: CommandEffects; by?: { name: string } },
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
    case 'create_category': {
      if (!input.effects.createCategory)
        throw new Error('Categories can only be made from Discord.');
      const created = await input.effects.createCategory({ name: step.args.name ?? '' });
      made.set(`category:${clean(step.args.name ?? '')}`, created.id);
      return { detail: `Created the category "${step.args.name ?? ''}"` };
    }
    case 'post_button': {
      if (!input.effects.postButton) throw new Error('Buttons can only be posted from Discord.');
      const labels = (step.args.buttons ?? '')
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
      const posted = await input.effects.postButton({
        channelId: channelId(step.args.channel ?? ''),
        text: step.args.text ?? '',
        buttons: labels.map((label) => ({
          id: `${step.args.kind ?? 'button'}:open:${label}`,
          label,
        })),
      });
      return {
        detail: `Posted the ${step.args.kind ?? ''} message in ${hash(step.args.channel ?? '')}`,
        link: posted.url,
      };
    }
    case 'set_support': {
      const { saveSupport } = await import('./support');
      const mode = step.args.mode as 'tickets' | 'help_channel' | 'existing_channel';
      const created = (step.args.created ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const [kind, name] = c.split(':') as ['category' | 'channel', string];
          const id =
            kind === 'category' ? made.get(`category:${clean(name)}`) : made.get(clean(name));
          return id ? { id, name, kind } : null;
        })
        .filter((c): c is { id: string; name: string; kind: 'category' | 'channel' } => Boolean(c));
      const channelName = step.args.channel ?? step.args.buttonChannel ?? '';
      const channel = channelName ? channelId(channelName) : null;
      const categoryName = step.args.category ?? '';
      const categoryId = categoryName
        ? (made.get(`category:${clean(categoryName)}`) ??
          find(input.shape.categories, categoryName)?.id)
        : undefined;
      const human = step.args.humanRole ? find(input.shape.roles, step.args.humanRole) : undefined;
      await saveSupport(
        input.guildId,
        {
          mode,
          created,
          categoryId,
          buttonChannelId: mode === 'tickets' ? (channel ?? undefined) : undefined,
          ticketKinds: (step.args.kinds ?? '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          humanRoleId: human?.id,
        },
        channel,
      );
      return { detail: step.sentence };
    }
    case 'assign_role': {
      const role = find(input.shape.roles, (step.args.roles ?? '').split(',')[0] ?? '');
      if (!role) throw new Error('That role is gone.');
      const member = step.args.member ?? '';
      await input.effects.assignRole({ userId: member, roleId: role.id });

      // A moderator who hands somebody a role has just vouched for them, and
      // that is an answer like any other: it is written down as knowledge, so
      // the next time somebody asks, nobody has to be asked again.
      await recordVouch(input.guildId, {
        memberName: step.args.memberName?.trim() || member,
        roleName: role.name,
        byName: input.by?.name ?? 'a moderator',
      }).catch(() => undefined);

      return { detail: `Gave ${step.args.memberName ?? member} the ${role.name} role` };
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

/**
 * The question the planner last put to this person, still waiting: their
 * next message is the answer to it, not a new request.
 */
export async function pendingCommandQuestion(
  guildId: string,
  userId: string,
): Promise<{ id: string; request: string; question: string } | null> {
  const since = new Date(Date.now() - ANSWER_WINDOW_MS).toISOString();
  const { data } = await serviceClient()
    .from('commands')
    .select('id, request, question')
    .eq('guild_id', guildId)
    .eq('asked_by', userId)
    .eq('status', 'asked')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.question ? { id: data.id, request: data.request, question: data.question } : null;
}

/** The question has its answer; the row stays as the record of it. */
export async function answerCommandQuestion(commandId: string): Promise<void> {
  await serviceClient().from('commands').update({ status: 'answered' }).eq('id', commandId);
}

/** How long an answer to the planner's question is waited for. */
const ANSWER_WINDOW_MS = 30 * 60 * 1000;

/**
 * The request with its answer folded in, so it can be planned again whole.
 *
 * A category, channel or role written loosely ("staff wcl" for "WCL | Staff")
 * is put in as the exact name when it names exactly one, so the planner is
 * handed a name that exists rather than asked to guess at spelling.
 */
export function withAnswer(request: string, answer: string, shape: GuildShape): string {
  const exact =
    nameOf(answer, shape.categories) ??
    nameOf(answer, shape.channels) ??
    nameOf(answer, shape.roles);
  return `${request.trim()} (${exact ? `"${exact}"` : answer.trim()})`;
}

/**
 * The one name in the list that every word of the text is part of, or null:
 * "staff wcl" is "WCL | Staff", "wcl" alone is two categories and so none.
 */
export function nameOf(text: string, list: { id?: string; name: string }[]): string | null {
  // Accents off as well: "competition" is "Compétition" to anyone typing fast.
  const fold = (value: string): string =>
    clean(value)
      .normalize('NFD')
      .replace(
        new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
        '',
      );
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const exact = list.find((item) => fold(item.name) === fold(text));
  if (exact) return exact.name;
  const fits = list.filter((item) => {
    const parts = new Set(
      fold(item.name)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
    return words.every((word) => parts.has(word));
  });
  return fits.length === 1 ? fits[0]!.name : null;
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
  if (step.memberName) args.memberName = step.memberName;
  return args;
}

/**
 * Whether a reply is a go-ahead rather than a refusal or a question.
 *
 * A yes, a give-verb or a confirmation, and no refusal anywhere in it: "no,
 * he's not on the roster" is not one, and neither is "which team is he on?".
 */
function goesAhead(request: string): boolean {
  const text = request
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    );
  const words = new Set(text.split(/[^a-z0-9']+/).filter(Boolean));
  for (const word of REFUSING) if (words.has(word)) return false;
  if (text.includes('?')) return false;
  for (const word of AGREEING) if (words.has(word)) return true;
  return false;
}

const AGREEING = new Set(
  (
    'yes yeah yep ok okay sure confirm confirmed confirme confirmé approved go give gives assign add grant ' +
    'oui ouais dacc daccord donne donnes mets met ajoute valide validé fine done right correct exact exactement'
  ).split(' '),
);

const REFUSING = new Set(
  "no nope not non pas jamais never dont don't cant can't refuse refused refuse nah".split(' '),
);

/** Words in a request that could be a member's name, at most a handful. */
function memberCandidates(request: string, roles: { id: string; name: string }[]): string[] {
  const roleWords = new Set(
    roles.flatMap((r) => clean(r.name).split(/[^a-z0-9]+/)).filter(Boolean),
  );
  return request
    .split(/[^\p{L}\p{N}_.-]+/u)
    .filter((word) => word.length >= 2 && word.length <= 32)
    .filter((word) => !FILLER.has(word.toLowerCase()) && !roleWords.has(clean(word)))
    .slice(0, 6);
}

/** The words a request is made of that are never anybody's name. */
const FILLER = new Set(
  (
    'give gives assign add put grant make set the an to role roles him her them please plz stp svp ' +
    'and et donne donnes mets met le la les un une du de des au rôle rôles this that guy mec ce cet ' +
    'cette on in with for can you tu peux me moi my mon je now pls'
  ).split(' '),
);

/** The user ids mentioned in a message, in order. */
function mentionsIn(text: string): string[] {
  return [...text.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]!);
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
      return `Give @${step.memberName ?? step.member ?? 'them'} the ${(step.roles ?? []).join(' and ')} role.`;
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

/**
 * Whether the request is about the asker rather than about somebody else.
 *
 * First person, and no third party named: "give me", "donne moi", "can I
 * have", "je veux". A request that says "me" and also names another member
 * ("give me and Craig the role") is left to the planner.
 */
function forThemselves(request: string): boolean {
  const text = request
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    );
  // Words, not a pattern: a word boundary in a pattern is exactly what a
  // shell mangles on the way in, and it fails silently.
  const words = text.split(/[^a-z0-9']+/).filter(Boolean);
  const has = new Set(words);
  const self =
    has.has('me') ||
    has.has('moi') ||
    has.has('myself') ||
    [
      'can i',
      'could i',
      'may i',
      'i want',
      'i need',
      "i'd like",
      'je veux',
      'je voudrais',
      'je peux',
      "j'aimerais",
    ].some((opening) => text.includes(opening));
  if (!self) return false;
  // "me and X", "moi et X", "me, X": somebody else is in it.
  for (let i = 0; i + 1 < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1]!;
    if ((word === 'me' || word === 'moi') && (next === 'and' || next === 'et')) return false;
    if ((word === 'me' || word === 'moi') && text.includes(`${word},`)) return false;
  }
  return true;
}

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
