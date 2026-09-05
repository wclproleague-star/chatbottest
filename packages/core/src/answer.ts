import type { Database, Json } from './database.types';
import { embed, generateJson, Type } from './gemini';
import type { Schema } from './gemini';
import { resolutionBrief, resolveTarget } from './resolve';
import type { Resolution, ResolutionContext } from './resolve';
import { serviceClient } from './supabase';
import { MODS } from './tokens';

type SettingsRow = Database['public']['Tables']['guild_settings']['Row'];
type Match = Database['public']['Functions']['match_chunks']['Returns'][number];

export const ACTION_TYPES = ['point_to_channel', 'assign_role', 'escalate'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What the model may propose. It never executes anything; the bot validates and acts. */
export type Action =
  | { type: 'point_to_channel'; channelId: string }
  | { type: 'assign_role'; roleId: string }
  | { type: 'escalate' };

export type HistoryTurn = { role: 'user' | 'model'; text: string };

export type AnswerInput = {
  guildId: string;
  question: string;
  askerName?: string;
  channelId?: string;
  /** The recent messages of the channel or thread; the last six are used. */
  history?: HistoryTurn[];
  /** Who is asking, as Discord shows them. */
  asker?: { nickname?: string; roles?: string[]; isStaff?: boolean };
  /** Where they wrote, which is often what tells you what they mean. */
  channel?: { name?: string; category?: string; topic?: string };
};

/** Why a message was flagged, from the model. */
export const FLAG_CATEGORIES = ['harassment', 'slur', 'nsfw', 'doxxing', 'scam'] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export { MODS };

/**
 * What the message is. `conversation`: the reply claims nothing about this
 * server, so nothing needs grounding. `server`: the reply says something about
 * the server, so every such claim is graded. `inappropriate`: no public reply.
 */
export const KINDS = ['conversation', 'server', 'inappropriate'] as const;
export type Kind = (typeof KINDS)[number];

/**
 * How a claim about the server stands up: `grounded`, a retrieved chunk says
 * it; `self`, a true statement about what Sentry holds; `partial`, a hedged
 * reading the chunks imply; `none`, nothing to stand on.
 */
export const GROUNDINGS = ['grounded', 'self', 'partial', 'none'] as const;
export type Grounding = (typeof GROUNDINGS)[number];
export type Claim = { text: string; grounding: Grounding; chunkIds: string[] };

/** How many recent messages the model sees as context. */
export const HISTORY_LIMIT = 6;

/**
 * One principle: Sentry converses naturally in the guild's persona, and never
 * states a fact about the server that is not grounded in retrieved chunks.
 * The tier is the weakest grounding among the reply's claims:
 * - answer: every claim is grounded or self, or the reply makes none.
 * - partial: a claim is a hedged reading; posted with {mods} asked to confirm,
 *   kept pending with the draft, so a mod's tick or correction becomes knowledge.
 * - none: a claim has nothing to stand on, or the topic is forbidden.
 * - flagged: inappropriate content, reported quietly to the mod channel.
 */
export type AnswerResult =
  | {
      tier: 'answer';
      resolution?: Resolution;
      answered: true;
      kind: 'conversation' | 'server';
      /** Carries {mods} only when the member asked for them, or asked what Sentry holds in full. */
      answer: string;
      claims: Claim[];
      confidence: number;
      usedChunkIds: string[];
      topChunkIds: string[];
      action?: Action;
    }
  | {
      tier: 'partial';
      resolution?: Resolution;
      answered: false;
      reason: 'partial';
      kind: 'server';
      /** The hedged reply, with {mods} in it. */
      reply: string;
      /** The pending question's draft: one sentence stating what the knowledge says. */
      draft: string;
      claims: Claim[];
      confidence: number;
      usedChunkIds: string[];
      topChunkIds: string[];
    }
  | {
      tier: 'none';
      resolution?: Resolution;
      answered: false;
      reason: 'no_knowledge' | 'refused';
      kind: 'server';
      /** The reply saying it does not have this, with {mods} in it. */
      reply: string;
      /** One sentence stating what was found, or what the closest entries cover. */
      found: string;
      claims: Claim[];
      refusalReason?: string;
      topChunkIds: string[];
    }
  | {
      /**
       * More than one thing could have been meant. One short question settles
       * it; the moderators are not involved and are not mentioned.
       */
      tier: 'clarify';
      answered: false;
      reason: 'ambiguous';
      kind: 'server';
      question: string;
      candidates: string[];
      resolution: Resolution;
      topChunkIds: [];
    }
  | {
      tier: 'flagged';
      answered: false;
      reason: 'flagged';
      kind: 'inappropriate';
      category: FlagCategory;
      /** One sentence for the mod channel report. */
      note: string;
      topChunkIds: [];
    };

const MATCH_COUNT = 6;
/** Replies vary in phrasing; the grading stays steady at this temperature. */
const TEMPERATURE = 0.7;

type Settings = {
  botName: string;
  persona: string | null;
  language: string | null;
  forbidden: string[];
  maxChars: number;
  threshold: number;
  allowedActions: ActionType[];
  selfServeRoleIds: string[];
  scope: 'open' | 'server_only';
  timezone: string | null;
};

type DiscordMeta = { channels: NamedId[]; roles: NamedId[] };
type NamedId = { id: string; name: string };

type ModelOutput = {
  kind: Kind;
  flagCategory?: string | null;
  found: string;
  /** Whether the member asked what Sentry itself knows, holds or has. */
  asksAboutKnowledge?: boolean | null;
  /** Whether the member asked if that is everything you know. */
  asksCompleteness?: boolean | null;
  /** Whether the member asked for a moderator themselves. */
  asksForModerators?: boolean | null;
  reply: string;
  claims?: { text: string; grounding: string; chunkIds?: string[] | null }[] | null;
  confidence: number;
  refused: boolean;
  refusalReason?: string | null;
  action?: {
    type: string;
    channelId?: string | null;
    roleId?: string | null;
    title?: string | null;
  } | null;
};

export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const { guildId, question } = input;
  const settings = await loadSettings(guildId);
  const history = (input.history ?? []).slice(-HISTORY_LIMIT);

  // What the message alone brings back, which also says how many things in the
  // knowledge could be meant.
  let matches = await retrieve(guildId, question, settings.threshold);

  // Who and where, then what they are referring to.
  const context = await resolutionContext(guildId, input, settings, matches.length);
  const resolution = await resolveTarget({ message: question, history, context });

  const base = {
    question,
    askerName: input.askerName,
    channelId: input.channelId,
    resolution: {
      subject: resolution.subject,
      entity: resolution.entity,
      timeWindow: resolution.timeWindow,
      basis: resolution.basis,
      candidates: resolution.candidates,
      outcome: resolution.outcome,
    },
  };

  // More than one thing could have been meant: one short question, no
  // moderators. Asking is not escalating.
  if (resolution.outcome === 'ambiguous') {
    const asked =
      resolution.question ??
      `Which one do you mean: ${resolution.candidates.slice(0, 4).join(', ')}?`;
    await logEvent(guildId, 'answered', { ...base, clarifying: asked });
    return {
      tier: 'clarify',
      answered: false,
      reason: 'ambiguous',
      kind: 'server',
      question: asked.slice(0, settings.maxChars),
      candidates: resolution.candidates,
      resolution,
      topChunkIds: [],
    };
  }

  // Resolved to one thing: look again with that thing named, so the retrieval
  // is about the match they mean rather than matches in general.
  if (resolution.outcome === 'unique' && resolution.entity) {
    const enriched = [question, resolution.entity, resolution.timeWindow].filter(Boolean).join(' ');
    const better = await retrieve(guildId, enriched, settings.threshold);
    if (better.length > 0) matches = better;
  }
  const topChunkIds = matches.map((m) => m.id);

  const meta = await loadMeta(guildId);
  const raw = await generateJson<ModelOutput>({
    system: systemPrompt(settings, matches, meta, resolution, context),
    messages: [
      ...history,
      { role: 'user', text: input.askerName ? `${input.askerName} says: ${question}` : question },
    ],
    schema: responseSchema(settings.allowedActions),
    temperature: TEMPERATURE,
  });

  const said = (raw.reply ?? '').trim().slice(0, settings.maxChars);
  const found = (raw.found ?? '').trim().slice(0, settings.maxChars) || said;
  const confidence = clamp01(raw.confidence);
  // The mention is a rule, not a choice.
  const withMods = said.includes(MODS) ? said : `${said} ${MODS}`.trim();
  const withoutMods = said
    .split(MODS)
    .join('the moderators')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (raw.kind === 'inappropriate') {
    const category = flagCategory(raw.flagCategory);
    const note = said || 'The message looked inappropriate.';
    await logEvent(guildId, 'flagged', { ...base, category, note });
    return {
      tier: 'flagged',
      answered: false,
      reason: 'flagged',
      kind: 'inappropriate',
      category,
      note,
      topChunkIds: [],
    };
  }

  // Conversation claims nothing about the server: answered directly, no gate, no tag.
  if (raw.kind === 'conversation') {
    await logEvent(guildId, 'answered', { ...base, kind: 'conversation' });
    return {
      tier: 'answer',
      resolution,
      answered: true,
      kind: 'conversation',
      answer: withoutMods,
      claims: [],
      confidence: 1,
      usedChunkIds: [],
      topChunkIds,
    };
  }

  // Server: grade every claim. A grounded or partial claim must cite a
  // retrieved chunk; without one it has nothing to stand on.
  const claims: Claim[] = (raw.claims ?? []).map((c) => {
    const chunkIds = (c.chunkIds ?? []).filter((id) => topChunkIds.includes(id));
    let grounding: Grounding = isGrounding(c.grounding) ? c.grounding : 'none';
    if ((grounding === 'grounded' || grounding === 'partial') && chunkIds.length === 0) {
      grounding = 'none';
    }
    // "I don't have that" stands as a self claim only when the member asked
    // what Sentry holds. Asked about the server, a missing fact is ungrounded.
    if (grounding === 'self' && !raw.asksAboutKnowledge) grounding = 'none';
    return { text: String(c.text ?? '').trim(), grounding, chunkIds };
  });
  const usedChunkIds = [...new Set(claims.flatMap((c) => c.chunkIds))];

  if (raw.refused) {
    const refusalReason = raw.refusalReason?.trim() || undefined;
    await logEvent(guildId, 'low_confidence', {
      ...base,
      reason: 'refused',
      refusalReason,
      topChunkIds,
      reply: withMods,
      found,
    });
    return {
      tier: 'none',
      resolution,
      answered: false,
      reason: 'refused',
      kind: 'server',
      reply: withMods,
      found,
      claims,
      refusalReason,
      topChunkIds,
    };
  }

  const weakest = weakestGrounding(claims);

  if (weakest === 'none') {
    await logEvent(guildId, 'low_confidence', {
      ...base,
      reason: 'no_knowledge',
      topChunkIds,
      reply: withMods,
      found,
    });
    return {
      tier: 'none',
      resolution,
      answered: false,
      reason: 'no_knowledge',
      kind: 'server',
      reply: withMods,
      found,
      claims,
      topChunkIds,
    };
  }

  // A hedged reading, or a grounded reply the model is not confident in under
  // the guild's threshold: posted with the mention and kept pending.
  const grounded = claims.some((c) => c.grounding === 'grounded');
  if (weakest === 'partial' || (grounded && confidence < settings.threshold)) {
    const capped = Math.min(confidence, 0.4);
    await logEvent(guildId, 'low_confidence', {
      ...base,
      reason: 'partial',
      confidence: capped,
      topChunkIds,
      usedChunkIds,
      draft: found,
    });
    return {
      tier: 'partial',
      resolution,
      answered: false,
      reason: 'partial',
      kind: 'server',
      reply: withMods,
      draft: found,
      claims,
      confidence: capped,
      usedChunkIds,
      topChunkIds,
    };
  }

  const action = validateAction(raw.action, settings, meta);
  await logEvent(guildId, 'answered', {
    ...base,
    kind: 'server',
    confidence,
    usedChunkIds,
    action,
  });
  return {
    tier: 'answer',
    resolution,
    answered: true,
    kind: 'server',
    // Asked whether that is all Sentry knows, the moderators are brought in to
    // fill the gap. Otherwise a tier 1 answer never mentions them, whatever
    // the model wrote.
    answer: raw.asksCompleteness || raw.asksForModerators ? withMods : withoutMods,
    claims,
    confidence: claims.length === 0 ? 1 : confidence,
    usedChunkIds,
    topChunkIds,
    ...(action ? { action } : {}),
  };
}

/** The weakest grounding present; with no claims, nothing about the server was said. */
function weakestGrounding(claims: Claim[]): Grounding {
  for (const g of ['none', 'partial', 'grounded', 'self'] as const) {
    if (claims.some((c) => c.grounding === g)) return g;
  }
  return 'self';
}

/** The chunks this guild has for a query, most alike first. */
async function retrieve(guildId: string, query: string, threshold: number): Promise<Match[]> {
  const [vector] = await embed([query], 'RETRIEVAL_QUERY');
  if (!vector) throw new Error('Embedding the question returned nothing.');
  const { data, error } = await serviceClient().rpc('match_chunks', {
    guild_id: guildId,
    query_embedding: JSON.stringify(vector),
    match_count: MATCH_COUNT,
    min_similarity: threshold,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);
  return data ?? [];
}

/**
 * Everything the bot may legitimately see, gathered for resolution: who is
 * asking and what they hold, where they are writing, what the server has said
 * about who belongs to what, what Sentry has already done for them, the time
 * where the server lives, and how much of the knowledge could be meant.
 */
async function resolutionContext(
  guildId: string,
  input: AnswerInput,
  settings: Settings,
  knowledgeCandidates: number,
): Promise<ResolutionContext> {
  const db = serviceClient();
  const [rosters, recent] = await Promise.all([
    db
      .from('documents')
      .select('title, raw_text')
      .eq('guild_id', guildId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(8),
    db
      .from('bot_events')
      .select('type, payload, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const asker = input.asker ?? {};
  const mine = (recent.data ?? []).filter((e) => {
    const payload = e.payload as { askerName?: string; channelId?: string } | null;
    return (
      payload?.askerName === input.askerName ||
      (input.channelId ? payload?.channelId === input.channelId : false)
    );
  });

  return {
    askerName: input.askerName ?? null,
    askerNickname: asker.nickname ?? null,
    askerRoles: asker.roles ?? [],
    askerIsStaff: asker.isStaff ?? false,
    channelName: input.channel?.name ?? null,
    categoryName: input.channel?.category ?? null,
    threadTopic: input.channel?.topic ?? null,
    rosters: (rosters.data ?? []).map(
      (d) => `${d.title ?? 'untitled'}: ${(d.raw_text ?? '').slice(0, 600)}`,
    ),
    recentActions: mine
      .slice(0, 5)
      .map((e) => `${e.created_at.slice(0, 16).replace('T', ' ')} ${e.type}`),
    knowledgeCandidates,
    now: nowIn(settings.timezone),
    timezone: settings.timezone,
  };
}

/** The date and time where the server lives, or in UTC when it has not said. */
function nowIn(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

// Settings and Discord metadata ------------------------------------------

async function loadSettings(guildId: string): Promise<Settings> {
  const { data, error } = await serviceClient()
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw new Error(`Could not load guild settings: ${error.message}`);
  const row: Partial<SettingsRow> = data ?? {};
  return {
    botName: row.bot_name || 'Sentry',
    persona: row.persona_prompt ?? null,
    language: row.language ?? null,
    forbidden: row.forbidden_topics ?? [],
    maxChars: row.max_reply_chars ?? 900,
    threshold: row.confidence_threshold ?? 0.55,
    allowedActions: (row.allowed_actions ?? []).filter(isActionType),
    selfServeRoleIds: row.self_serve_role_ids ?? [],
    scope: row.scope === 'server_only' ? 'server_only' : 'open',
    timezone: row.timezone ?? null,
  };
}

async function loadMeta(guildId: string): Promise<DiscordMeta | null> {
  const { data } = await serviceClient()
    .from('guild_discord_meta')
    .select('channels, roles')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (!data) return null;
  return { channels: namedIds(data.channels), roles: namedIds(data.roles) };
}

function namedIds(value: Json): NamedId[] {
  if (!Array.isArray(value)) return [];
  const out: NamedId[] = [];
  for (const item of value) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const { id, name } = item;
      if (typeof id === 'string' && typeof name === 'string') out.push({ id, name });
    }
  }
  return out;
}

function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

function isGrounding(value: string): value is Grounding {
  return (GROUNDINGS as readonly string[]).includes(value);
}

function flagCategory(value: string | null | undefined): FlagCategory {
  return (FLAG_CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as FlagCategory)
    : 'harassment';
}

/** The time in the guild's zone, as "18:00 CET, Sun 7 Sep"; null when the zone is not valid. */
function clockLine(timezone: string): string | null {
  try {
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(now);
    const day = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(now);
    return `${time}, ${day}`;
  } catch {
    return null;
  }
}

// Prompt and schema -------------------------------------------------------

function systemPrompt(
  s: Settings,
  matches: Match[],
  meta: DiscordMeta | null,
  resolution: Resolution,
  context: ResolutionContext,
): string {
  const clock = s.timezone ? clockLine(s.timezone) : null;
  const lines: string[] = [
    `You are ${s.botName}, the assistant for a Discord server. Members mention you and you reply in the channel, in character, in your own words every time. The messages before this one are the recent conversation; use them as context.`,
  ];
  if (s.persona) lines.push(s.persona);
  lines.push(
    s.language ? `Reply in ${s.language}.` : 'Reply in the language the member wrote in.',
    '',
    'The one rule: converse naturally, and never state a fact about this server (dates, times, rules, names, prices, results, roles, who does what) that is not grounded in the knowledge below.',
    '',
    `Now: ${context.now}${context.timezone ? ` (${context.timezone})` : ''}. When the knowledge holds several of the thing they asked about, take the one their time window points at, ordered by date and time from now: "next" means the first still ahead, "last" the most recent behind.`,
    resolution.aboutServer
      ? ''
      : 'What they are asking about does not belong to this server, so this is conversation: answer it yourself, from what you know, and leave the moderators out of it.',
    resolution.outcome === 'unresolved'
      ? `What they are referring to could not be worked out: they mean a specific ${resolution.subject} and nothing in the message or around them says which. Say plainly that you cannot tell which one they mean, do not guess, and hand it to the moderators with the literal token ${MODS}.`
      : resolutionBrief(resolution),
    '',
    'Decide kind first:',
    '- inappropriate: harassment, insults aimed at a person, slurs, sexual or NSFW content, doxxing (posting or asking for private details), scam or phishing links (free nitro, giveaways, login pages). Set flagCategory to one of harassment, slur, nsfw, doxxing, scam, and make reply one plain sentence for the moderators describing what was posted and why it was flagged. It is never shown to the member.',
    '- conversation: the reply claims nothing about this server. Greetings, thanks, banter, jokes, questions about you as a bot, and general knowledge (a capital city, a definition, arithmetic) are all conversation. Answer directly and briefly, in character, with no mention of the moderators. There is no knowledge gate on conversation.',
    '- server: the message is about this server, its schedule, rules, roles, channels, people or moderators; or your reply would state something about the server.',
    '- Asking what you know, hold or have is always server, never conversation, whatever the subject. "What do you know about baguettes?" is server: you are being asked about your own holdings, and you answer from them.',
    '',
    s.scope === 'server_only'
      ? 'Scope: server only. Do not answer general-knowledge questions; reply with a friendly one-line redirect to what you can help with here. That is still conversation.'
      : "Scope: open. General-knowledge questions are answered directly, as conversation, from what you know rather than from this server's knowledge. Two limits on that. Never state a specific figure, version, date or name you are not sure of: say you are not certain of the exact one rather than producing something plausible. And for anything that moves, a patch, the current meta, a price, a ranking, the news, say plainly that your information may be out of date, so they can check. Neither of these involves the moderators.",
    clock
      ? `The server's timezone is ${s.timezone} and the time there now is ${clock}. Asked the time, give it. That is conversation.`
      : 'No timezone is set for this server, so you do not know the time. Asked the time, ask which timezone they mean. That is conversation.',
    '',
    'For every message, before the reply, write found: one plain sentence stating exactly what the knowledge says that bears on it, naming the specifics (times, channels, rules), or stating that nothing in it relates and what the closest entries cover instead. Never "not sure about that case"; found is what you found.',
    '',
    'For a server message, draft the reply, then list every claim about the server in it under claims, each with its grounding:',
    '- grounded: the knowledge states it outright, in words you could quote. Put the chunk ids in chunkIds. Say it plainly. An inference is never grounded, however safe it feels.',
    `- self: only when the member asked what you know, hold or have. Then the answer is a true statement about your holdings ("that is the only match in what I have", "I have nothing on baguettes"), no chunk needed, said directly and never hedged. Set asksCompleteness true only when they ask whether that is all you know (only, all, everything, anything else); asking what you know about a subject is not that. Never use self for a server question you cannot answer: that claim is none, however you phrase it.`,
    `- partial: the knowledge does not state it but implies it for this exact case. Anything you conclude from what a list does not contain is partial: a day, a slot or a case the knowledge never mentions (the schedule lists Tuesday, Thursday and Sunday, so a Saturday match is unlikely) is a reading, not a fact, no matter how clearly the list implies it. Put the chunks it rests on in chunkIds, hedge it in the reply so it reads as a reading and not a fact, and ask the moderators to confirm in the same message with the literal token ${MODS}.`,
    `- none: the member asked about the server and nothing in the knowledge bears on it, even if the topic appears (check-in rules exist, but nothing about a teammate missing it; conduct rules exist, but nothing about substitutes or past results). "I don't have anything on that" is a claim of grounding none, not self: they asked about the server, not about you. Do not state it as fact and do not turn a mention of the topic into a reading; say naturally that you do not have this, and mention the moderators with the literal token ${MODS}. Never hedge on nothing.`,
    `- A request aimed at the moderators ("ping the mods") is a server message: say you are bringing them in, and mention them with ${MODS}.`,
    '- What you are doing right now ("bringing them in", "let me check") is not a fact about the server. Do not list it as a claim.',
    '- When the member asks for a fact about the server and you cannot state it, that absence is itself the claim: list "I have nothing on X" with grounding none. Never return an empty claims list for a question that asked for a server fact.',
    '- Only a server message that asks for no fact at all (a request to fetch the moderators) lists no claims.',
    '',
    'Examples of the voice, for phrasing only; never reuse them word for word, vary every time:',
    `- partial: "I don't think there's a match Saturday, the schedule I have only lists Tuesday, Thursday and Sunday. ${MODS}, can you confirm?"`,
    `- none: "I don't have anything on that yet. ${MODS}, can one of you take this?"`,
    `- none: "That's not something I've been given. Pinging ${MODS} for you."`,
    `- self: "In what I have, that's the only match: the finals bracket goes up Sunday at 18:00 CET. ${MODS}, is there more?"`,
    '- self, asked what you know: "Nothing on baguettes, sorry. I have the server rules, the tournament schedule and the roles."',
    `- none, asked a server question you cannot answer: "I've got nothing on substitutes. ${MODS}, can one of you take this?"`,
    '- conversation: "Hey. Ask me anything about the server."',
    '- conversation: "Paris."',
    '',
    'Rules:',
    '- Never invent dates, prices, names, or rules. If a detail is not in the knowledge, it is not a fact.',
    `- Keep the reply under ${s.maxChars} characters. Plain sentences; no headings, and no bullet list unless the member asked for one.`,
    '- confidence is 0 to 1: how completely the knowledge supports the server claims in the reply. Conversation is 1.',
    s.forbidden.length > 0
      ? `- Forbidden topics: ${s.forbidden.join('; ')}. If the message touches one, set refused to true, give a short refusalReason, and make reply a one-line handoff to the moderators with ${MODS} in it.`
      : '- No topics are forbidden.',
    ...actionRules(s, meta),
    '',
    matches.length > 0 ? 'Knowledge:' : 'Knowledge: none was found for this message.',
    ...matches.map((m) => `[id: ${m.id}]\n${m.content}`),
  );
  return lines.join('\n');
}

function actionRules(s: Settings, meta: DiscordMeta | null): string[] {
  if (s.allowedActions.length === 0) return ['- Do not propose any action; leave it out.'];
  const lines = [
    `- You may propose at most one action, only when every claim is grounded or self, only when it clearly helps, and only of these types: ${s.allowedActions.join(', ')}. Otherwise leave action null.`,
  ];
  const needsChannel = s.allowedActions.includes('point_to_channel');
  if (needsChannel) {
    lines.push(
      meta && meta.channels.length > 0
        ? `- Channels (name: id): ${meta.channels.map((c) => `#${c.name}: ${c.id}`).join(', ')}. Put the id in channelId.`
        : '- No channel ids are known yet, so do not propose point_to_channel.',
    );
  }
  if (s.allowedActions.includes('assign_role')) {
    const roles = meta ? meta.roles.filter((r) => s.selfServeRoleIds.includes(r.id)) : [];
    lines.push(
      roles.length > 0
        ? `- Roles you may assign (name: id): ${roles.map((r) => `${r.name}: ${r.id}`).join(', ')}. Put the id in roleId.`
        : '- No assignable roles are known yet, so do not propose assign_role.',
    );
  }
  return lines;
}

function responseSchema(allowed: ActionType[]): Schema {
  const properties: Record<string, Schema> = {
    // Ordered: kind, then what was found, then the reply, then its claims.
    kind: { type: Type.STRING, enum: [...KINDS], description: 'Decide this first.' },
    flagCategory: {
      type: Type.STRING,
      nullable: true,
      enum: [...FLAG_CATEGORIES],
      description: 'Only when kind is inappropriate.',
    },
    found: {
      type: Type.STRING,
      description:
        'One sentence stating exactly what the knowledge says that bears on this message, or that nothing relates. Never a hedge.',
    },
    asksAboutKnowledge: {
      type: Type.BOOLEAN,
      nullable: true,
      description:
        'True when the member asks what you know, hold or have ("what do you know about X", "is that all you know", "do you have anything on Y"). False when they ask a question about the server itself.',
    },
    asksCompleteness: {
      type: Type.BOOLEAN,
      nullable: true,
      description:
        'True only when the member asks whether there is more beyond what you hold: "is that the only one", "is that all you know", "anything else?". False when they simply ask what you know about a subject: "what do you know about X" is False.',
    },
    asksForModerators: {
      type: Type.BOOLEAN,
      nullable: true,
      description:
        'True when the member is asking for a moderator, a human or the staff ("ping the mods", "can someone from staff look at this").',
    },
    reply: {
      type: Type.STRING,
      description:
        'The message to send, in character. For inappropriate, one sentence for the moderators instead.',
    },
    claims: {
      type: Type.ARRAY,
      nullable: true,
      description:
        'Every claim about this server made in the reply, with its grounding. Empty for conversation.',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          grounding: { type: Type.STRING, enum: [...GROUNDINGS] },
          chunkIds: { type: Type.ARRAY, nullable: true, items: { type: Type.STRING } },
        },
        required: ['text', 'grounding'],
        propertyOrdering: ['text', 'grounding', 'chunkIds'],
      },
    },
    confidence: { type: Type.NUMBER },
    refused: { type: Type.BOOLEAN },
    refusalReason: { type: Type.STRING, nullable: true },
  };
  if (allowed.length > 0) {
    properties.action = {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        type: { type: Type.STRING, enum: [...allowed] },
        channelId: { type: Type.STRING, nullable: true },
        roleId: { type: Type.STRING, nullable: true },
        title: { type: Type.STRING, nullable: true },
      },
      required: ['type'],
    };
  }
  return {
    type: Type.OBJECT,
    properties,
    required: ['kind', 'found', 'reply', 'confidence', 'refused'],
    propertyOrdering: Object.keys(properties),
  };
}

// Output validation -------------------------------------------------------

function validateAction(
  raw: ModelOutput['action'],
  s: Settings,
  meta: DiscordMeta | null,
): Action | undefined {
  if (!raw || !isActionType(raw.type) || !s.allowedActions.includes(raw.type)) return undefined;
  const knownChannel = (id: string | null | undefined): id is string =>
    typeof id === 'string' && !!meta && meta.channels.some((c) => c.id === id);

  switch (raw.type) {
    case 'escalate':
      return { type: 'escalate' };
    case 'point_to_channel':
      return knownChannel(raw.channelId)
        ? { type: 'point_to_channel', channelId: raw.channelId }
        : undefined;
    case 'assign_role': {
      const roleId = raw.roleId;
      return typeof roleId === 'string' && s.selfServeRoleIds.includes(roleId)
        ? { type: 'assign_role', roleId }
        : undefined;
    }
  }
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
}

async function logEvent(
  guildId: string,
  type: 'answered' | 'low_confidence' | 'flagged',
  payload: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await serviceClient()
    .from('bot_events')
    .insert({ guild_id: guildId, type, payload });
  if (error) throw new Error(`Could not write bot_events: ${error.message}`);
}
