// Resolution: who or what the member is talking about, worked out before
// anything is retrieved.
//
// A member rarely names the thing in full. They say "the game", "my next
// match", "is it cancelled". What they mean is usually decidable from what is
// around them, so this step takes every signal the bot may legitimately see:
// the message itself, the last few messages including Kalvard's own, who is
// asking and what they hold, where they are writing, what the server has said
// about who belongs to what, what Kalvard has already done for them, the time
// where the server lives, and how much of the knowledge could be meant. It
// returns a target and says whether it is unique, ambiguous, or not resolvable
// at all. One mechanism, rather than a rule per kind of reference.

import { generateJson, Type } from './gemini';
import type { Schema } from './gemini';

export type ResolutionOutcome = 'unique' | 'ambiguous' | 'unresolved';

export type Resolution = {
  /** The kind of thing asked about: a match, a role, a channel, a rule. */
  subject: string;
  /** Which one, once resolved. Null when the message needs no entity, or none was found. */
  entity: string | null;
  /** The stretch of time asked about: "next", "last week", "Sunday". Null when timeless. */
  timeWindow: string | null;
  /**
   * Where the entity came from, when it came from the context rather than the
   * message itself: "your Fast Forward role". Null when they named it.
   */
  basis: string | null;
  /** What could have been meant. One when unique, several when ambiguous. */
  candidates: string[];
  outcome: ResolutionOutcome;
  /** When ambiguous: the one short question to put to the member. */
  question: string | null;
  /**
   * Whether they are asking what Kalvard itself holds rather than about one
   * instance of a thing. Such a question is never ambiguous: it is about the
   * whole of what is known, so there is nothing to choose between.
   */
  aboutHoldings: boolean;
  /**
   * Whether the thing they mean belongs to this server. A question about the
   * world outside it has nothing here to resolve against.
   */
  aboutServer: boolean;
  /**
   * What the message is, as opposed to what it refers to. These are decided
   * here because they are judgements about one short message, steady at
   * temperature zero, where the model that also has to write a reply and grade
   * it wobbles between them from one run to the next.
   */
  asksNothing: boolean;
  asksIfExists: boolean;
  asksForAnAction: boolean;
  needsAPerson: boolean;
  addressedToSomeoneElse: boolean;
};

/** Everything around the member that could say what they mean. */
export type ResolutionContext = {
  /** Who is asking: their name, their nickname here, what they hold, whether they are staff. */
  askerName: string | null;
  askerNickname: string | null;
  askerRoles: string[];
  askerIsStaff: boolean;
  /** Where they wrote: the channel, the category above it, the thread's topic. */
  channelName: string | null;
  categoryName: string | null;
  threadTopic: string | null;
  /** Rosters and other documents that say who belongs to what, as text. */
  rosters: string[];
  /** What Kalvard has recently done for this member or in this channel. */
  recentActions: string[];
  /** How many things in the knowledge could be what they mean. */
  knowledgeCandidates: number;
  /** Now, in the guild's timezone, and the timezone itself. */
  now: string;
  timezone: string | null;
};

const SYSTEM = `You work out what a member of a Discord server is referring to, before anyone looks anything up.

Read their message, the conversation before it, and the context around them, and fill in the target:
- subject: the kind of thing they are asking about, in one or two words ("match", "role", "channel", "rule", "result", "schedule").
- entity: which specific one, if their message is about a specific one. Null when the question is general ("when do group matches run") or when nothing identifies it.
- timeWindow: the stretch of time they mean ("next", "this weekend", "last week", "Sunday"), or null.
- basis: where the entity came from, when it came from the context rather than their words: "your Fast Forward role", "the channel you are writing in", "what you asked a minute ago". Null when they named the thing themselves.
- candidates: everything that could plausibly be meant. One entry when it is clear, several when it is not.
- outcome:
  - unique: they named it, or the context leaves exactly one thing it can be, or the question needs no specific entity at all.
  - ambiguous: the context offers more than one candidate and nothing chooses between them.
  - unresolved: they are asking about a specific thing, and nothing in the message or the context says which.
- question: only when ambiguous, one short question naming the candidates, in their language. Null otherwise.
- aboutServer: true when the thing they mean belongs to this server: its matches, roles, rules, channels, people, and how it runs itself, which includes its entry fees, prizes, sign-ups, deadlines and staff. False only for the world outside it: a game's patch notes, a capital city, the weather. When you are unsure, say true. Mistaking the world for this server costs one question to a moderator; mistaking this server for the world invents facts about it.
- asksNothing: true when the message asks for nothing at all: an acknowledgement ("ok", "d'accord", "👍"), thanks, or a remark with no request in it.
- asksIfExists: true when they are asking whether something exists or is happening at all ("is there a match on Saturday", "do we play this weekend", "is there a rule about subs"), rather than for the details of something they already know exists.
- asksForAnAction: true only when they are asking you to carry something out: give a role, create a channel, ban someone. Asking you to tell, confirm, check, explain or look up a fact is never this, however it is phrased: "confirme", "vérifie", "tu peux me dire" are all questions.
- needsAPerson: true when what they want can only be decided by a human: a ban, a kick, a mute, a dispute between members, an appeal.
- addressedToSomeoneElse: true when the message is aimed at another member and only mentions you in passing, so nothing is being asked of you.
- aboutHoldings: true when they are asking what you yourself know or have ("what do you know about X", "is that the only match you know about", "do you have anything on Y"), rather than about one instance of a thing.

Use every signal you are given, in this order of weight: what they wrote, then the conversation just before it, then who they are and what they hold, then where they wrote it, then what Kalvard has just done for them.

Rules:
- Resolve from the context, never from what you imagine the server to be. If the context does not contain it, do not invent it.
- A pronoun or a bare noun ("it", "the game", "the match") refers to whatever the recent conversation was about, or to what the context makes obvious. Treat it exactly like any other reference.
- Holding one team role makes "my match" unique, and the basis is that role; holding two makes it ambiguous between them.
- The channel, its category and a thread's topic are context: a question asked in a team's own channel usually means that team.
- Ambiguity is about instances, never about topics. Which match, which team, which role: those can be ambiguous. A procedure, a rule, a general "how do I", or a question about what you yourself know needs no instance at all, so its outcome is unique with entity null, however many things the knowledge holds.
- Only say ambiguous when they are asking about one instance and the context genuinely offers more than one. Asking about something in general is unique.
- A question about whether something exists, or about a set taken as a whole ("is there a match on Saturday", "do we play this weekend", "how many games are left"), needs no instance: it is answered from all of them at once. Unique, entity null. A time window is itself a way of choosing, so it never leaves anything to ask.
- Ambiguity is never about which document or which version of the knowledge says a thing. A member cannot know that, and asking them to choose between two of your sources is not a question they can answer. Two documents describing the same rule are one target, and the disagreement is dealt with in the reply, not here.
- Being unable to decide is not failure. Say ambiguous, and let one question settle it.

Two that look alike and are not:
- "when is the game?", with several fixtures in the knowledge and nothing saying which: subject match, entity null, ambiguous, and the question names the fixtures.
- "is that the only match you know about?": they are asking what you hold, not about one fixture. Subject match, entity null, unique.`;

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING },
    entity: { type: Type.STRING, nullable: true },
    timeWindow: { type: Type.STRING, nullable: true },
    basis: { type: Type.STRING, nullable: true },
    candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
    outcome: { type: Type.STRING, enum: ['unique', 'ambiguous', 'unresolved'] },
    question: { type: Type.STRING, nullable: true },
    aboutServer: { type: Type.BOOLEAN },
    aboutHoldings: { type: Type.BOOLEAN },
    asksNothing: { type: Type.BOOLEAN },
    asksIfExists: { type: Type.BOOLEAN },
    asksForAnAction: { type: Type.BOOLEAN },
    needsAPerson: { type: Type.BOOLEAN },
    addressedToSomeoneElse: { type: Type.BOOLEAN },
  },
  required: [
    'subject',
    'entity',
    'timeWindow',
    'basis',
    'candidates',
    'outcome',
    'question',
    'aboutServer',
    'aboutHoldings',
    'asksNothing',
    'asksIfExists',
    'asksForAnAction',
    'needsAPerson',
    'addressedToSomeoneElse',
  ],
  propertyOrdering: [
    'subject',
    'entity',
    'timeWindow',
    'basis',
    'candidates',
    'outcome',
    'question',
    'aboutServer',
    'aboutHoldings',
    'asksNothing',
    'asksIfExists',
    'asksForAnAction',
    'needsAPerson',
    'addressedToSomeoneElse',
  ],
};

export async function resolveTarget(input: {
  message: string;
  history: { role: 'user' | 'model'; text: string }[];
  context: ResolutionContext;
}): Promise<Resolution> {
  const { context: c } = input;
  const lines = [
    `Now: ${c.now}${c.timezone ? ` (${c.timezone})` : ''}`,
    `The asker: ${c.askerName ?? 'unknown'}${c.askerNickname ? `, known here as ${c.askerNickname}` : ''}${c.askerIsStaff ? ', a moderator' : ''}`,
    `Their roles: ${c.askerRoles.length > 0 ? c.askerRoles.join(', ') : 'none known'}`,
    `The channel: ${c.channelName ?? 'unknown'}${c.categoryName ? `, under ${c.categoryName}` : ''}${c.threadTopic ? `, topic: ${c.threadTopic}` : ''}`,
    `Things in the knowledge that could be meant: ${c.knowledgeCandidates}`,
    c.recentActions.length > 0
      ? `What Kalvard has recently done here: ${c.recentActions.join('; ')}`
      : 'Kalvard has done nothing here recently.',
    c.rosters.length > 0
      ? `Rosters and lists the server has given Kalvard:\n${c.rosters.join('\n---\n').slice(0, 4000)}`
      : 'No rosters are known.',
  ];

  const raw = await generateJson<Resolution>({
    system: `${SYSTEM}\n\nContext:\n${lines.join('\n')}`,
    messages: [...input.history, { role: 'user', text: input.message }],
    schema: SCHEMA,
    temperature: 0.1,
  });

  const candidates = (raw.candidates ?? []).map((x) => String(x).trim()).filter(Boolean);
  let outcome: ResolutionOutcome = (['unique', 'ambiguous', 'unresolved'] as const).includes(
    raw.outcome,
  )
    ? raw.outcome
    : 'unique';

  // Not trusted to the model, because these are the calls it drifts on.
  // One candidate is not a choice, and several with nothing chosen between
  // them is not a resolution.
  if (outcome === 'ambiguous' && candidates.length < 2) {
    outcome = raw.entity ? 'unique' : 'unresolved';
  }
  if (outcome === 'unique' && candidates.length > 1 && !raw.entity) outcome = 'ambiguous';

  // Asking what Kalvard holds is about the whole of it, so there is nothing to
  // choose between and nothing to ask.
  if (raw.asksNothing) outcome = 'unique';
  if (raw.aboutHoldings) outcome = 'unique';

  // Nothing of this server's is being referred to, so there is nothing here to
  // resolve and no reason to hand it to a moderator.
  if (raw.aboutServer === false) outcome = 'unique';

  // A time window is itself a choice: "on Saturday" picks out whatever falls
  // there, so nothing is left to ask.
  if (outcome === 'ambiguous' && raw.timeWindow && !raw.entity) outcome = 'unique';

  // What the member holds is what makes "my match" resolvable, so when they
  // hold more than one thing that fits and named none of them, choosing would
  // be a guess. Ask instead.
  const said = normalise([input.message, ...input.history.map((h) => h.text)].join(' '));
  const namedOne = candidates.some((c) => said.includes(normalise(c)));
  const theirs = c.askerRoles.filter((role) =>
    candidates.some((candidate) => normalise(candidate).includes(normalise(role))),
  );
  if (!raw.aboutHoldings && theirs.length > 1 && !namedOne) outcome = 'ambiguous';

  return {
    aboutServer: raw.aboutServer !== false,
    aboutHoldings: Boolean(raw.aboutHoldings),
    asksNothing: Boolean(raw.asksNothing),
    asksIfExists: Boolean(raw.asksIfExists),
    asksForAnAction: Boolean(raw.asksForAnAction),
    needsAPerson: Boolean(raw.needsAPerson),
    addressedToSomeoneElse: Boolean(raw.addressedToSomeoneElse),
    subject: String(raw.subject ?? '').trim() || 'unknown',
    entity: raw.entity?.trim() || null,
    timeWindow: raw.timeWindow?.trim() || null,
    basis: raw.basis?.trim() || null,
    candidates,
    outcome,
    question: raw.question?.trim() || null,
  };
}

/** Lowercase and without accents, so names compare the way people write them. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** What the answering prompt is told about the target, once it is settled. */
export function resolutionBrief(r: Resolution): string {
  if (r.outcome !== 'unique') return '';
  const parts = [
    `They are asking about: ${r.subject}${r.entity ? `, specifically ${r.entity}` : ''}.`,
  ];
  if (r.timeWindow) parts.push(`The time they mean: ${r.timeWindow}.`);
  if (r.entity) {
    parts.push(
      r.basis
        ? `They did not name it; it was worked out from ${r.basis}. Your reply must name it and say briefly where it came from, so they can correct you if it is the wrong one. Do this even when they are following up on something you just said.`
        : 'Your reply must name it, so they can see what you answered about.',
    );
  }
  return parts.join(' ');
}
