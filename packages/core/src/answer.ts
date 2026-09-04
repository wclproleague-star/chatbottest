import type { Database, Json } from './database.types';
import { embed, generateJson, Type } from './gemini';
import type { Schema } from './gemini';
import { serviceClient } from './supabase';

type SettingsRow = Database['public']['Tables']['guild_settings']['Row'];
type Match = Database['public']['Functions']['match_chunks']['Returns'][number];

export const ACTION_TYPES = ['point_to_channel', 'assign_role', 'open_thread', 'escalate'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What the model may propose. It never executes anything; the bot validates and acts. */
export type Action =
  | { type: 'point_to_channel'; channelId: string }
  | { type: 'assign_role'; roleId: string }
  | { type: 'open_thread'; channelId: string; title: string }
  | { type: 'escalate' };

export type HistoryTurn = { role: 'user' | 'model'; text: string };

export type AnswerInput = {
  guildId: string;
  question: string;
  askerName?: string;
  channelId?: string;
  history?: HistoryTurn[];
};

export type AnswerResult =
  | {
      answered: true;
      answer: string;
      confidence: number;
      usedChunkIds: string[];
      topChunkIds: string[];
      action?: Action;
    }
  | { answered: false; reason: 'no_knowledge'; topChunkIds: string[] }
  | {
      answered: false;
      reason: 'low_confidence' | 'refused';
      draft: string;
      confidence: number;
      refusalReason?: string;
      topChunkIds: string[];
    };

const MATCH_COUNT = 6;

type Settings = {
  botName: string;
  persona: string | null;
  language: string | null;
  forbidden: string[];
  maxChars: number;
  threshold: number;
  allowedActions: ActionType[];
  selfServeRoleIds: string[];
};

type DiscordMeta = { channels: NamedId[]; roles: NamedId[] };
type NamedId = { id: string; name: string };

type ModelOutput = {
  /** Decided before the answer is written; the schema orders it first. */
  coverage: 'full' | 'partial' | 'none';
  answer: string;
  confidence: number;
  usedChunkIds: string[];
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
  const db = serviceClient();
  const settings = await loadSettings(guildId);

  const [queryVector] = await embed([question], 'RETRIEVAL_QUERY');
  if (!queryVector) throw new Error('Embedding the question returned nothing.');

  const matched = await db.rpc('match_chunks', {
    guild_id: guildId,
    query_embedding: JSON.stringify(queryVector),
    match_count: MATCH_COUNT,
    min_similarity: settings.threshold,
  });
  if (matched.error) throw new Error(`match_chunks failed: ${matched.error.message}`);
  const matches = matched.data ?? [];
  const topChunkIds = matches.map((m) => m.id);

  const base = { question, askerName: input.askerName, channelId: input.channelId };

  if (matches.length === 0) {
    await logEvent(guildId, 'low_confidence', { ...base, reason: 'no_knowledge' });
    return { answered: false, reason: 'no_knowledge', topChunkIds: [] };
  }

  const meta = await loadMeta(guildId);
  const raw = await generateJson<ModelOutput>({
    system: systemPrompt(settings, matches, meta),
    messages: [
      ...(input.history ?? []),
      { role: 'user', text: input.askerName ? `${input.askerName} asks: ${question}` : question },
    ],
    schema: responseSchema(settings.allowedActions),
  });

  // Partial coverage is not an answer. Cap it under the default threshold so it
  // reaches a moderator; an owner who moves the slider to Confident accepts it.
  const confidence =
    raw.coverage === 'full' ? clamp01(raw.confidence) : Math.min(clamp01(raw.confidence), 0.4);
  const draft = (raw.answer ?? '').trim().slice(0, settings.maxChars);
  const usedChunkIds = (raw.usedChunkIds ?? []).filter((id) => topChunkIds.includes(id));
  const action = validateAction(raw.action, settings, meta);

  if (raw.refused) {
    const refusalReason = raw.refusalReason?.trim() || undefined;
    await logEvent(guildId, 'low_confidence', {
      ...base,
      reason: 'refused',
      refusalReason,
      confidence,
      topChunkIds,
      draft,
    });
    return { answered: false, reason: 'refused', draft, confidence, refusalReason, topChunkIds };
  }

  if (confidence < settings.threshold) {
    await logEvent(guildId, 'low_confidence', {
      ...base,
      reason: 'low_confidence',
      confidence,
      topChunkIds,
      draft,
    });
    return { answered: false, reason: 'low_confidence', draft, confidence, topChunkIds };
  }

  await logEvent(guildId, 'answered', { ...base, confidence, usedChunkIds, action });
  return {
    answered: true,
    answer: draft,
    confidence,
    usedChunkIds,
    topChunkIds,
    ...(action ? { action } : {}),
  };
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

// Prompt and schema -------------------------------------------------------

function systemPrompt(s: Settings, matches: Match[], meta: DiscordMeta | null): string {
  const lines: string[] = [
    `You are ${s.botName}, the assistant for a Discord server. Members mention you with a question and you reply in the channel.`,
  ];
  if (s.persona) lines.push(s.persona);
  lines.push(
    s.language ? `Reply in ${s.language}.` : 'Reply in the language the member wrote in.',
    '',
    'Rules:',
    '- Answer only from the knowledge below.',
    '- First decide coverage. full: the knowledge answers the exact question asked. partial: it covers the topic but not the specific case asked about, such as an exception, an edge case, or a what-if. none: it is unrelated.',
    '- Related is not answered. When coverage is partial or none, do not answer the nearby question instead. Say in one short line that you are not sure about that specific case, and set confidence below 0.3.',
    '- Never invent dates, prices, names, or rules. If a detail is not in the knowledge, do not state it.',
    `- Keep the answer under ${s.maxChars} characters. Plain sentences; no headings, and no bullet list unless the member asked for one.`,
    '- confidence is 0 to 1: how completely the knowledge answers this exact question.',
    '- usedChunkIds lists the ids of the knowledge entries the answer relies on.',
    s.forbidden.length > 0
      ? `- Forbidden topics: ${s.forbidden.join('; ')}. If the question touches one, set refused to true, give a short refusalReason, and make answer a one-line handoff to the moderators.`
      : '- No topics are forbidden.',
    ...actionRules(s, meta),
    '',
    'Knowledge:',
    ...matches.map((m) => `[id: ${m.id}]\n${m.content}`),
  );
  return lines.join('\n');
}

function actionRules(s: Settings, meta: DiscordMeta | null): string[] {
  if (s.allowedActions.length === 0) return ['- Do not propose any action; leave it out.'];
  const lines = [
    `- You may propose at most one action, only when it clearly helps, and only of these types: ${s.allowedActions.join(', ')}. Otherwise leave action null.`,
  ];
  const needsChannel =
    s.allowedActions.includes('point_to_channel') || s.allowedActions.includes('open_thread');
  if (needsChannel) {
    lines.push(
      meta && meta.channels.length > 0
        ? `- Channels (name: id): ${meta.channels.map((c) => `#${c.name}: ${c.id}`).join(', ')}. Put the id in channelId.`
        : '- No channel ids are known yet, so do not propose point_to_channel or open_thread.',
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
    // First in propertyOrdering, so the model commits to coverage before writing.
    coverage: {
      type: Type.STRING,
      enum: ['full', 'partial', 'none'],
      description:
        'Decide this first. full: the knowledge answers the exact question. partial: it covers the topic but not this specific case. none: unrelated.',
    },
    answer: {
      type: Type.STRING,
      description: 'The reply to send. A one-line handoff when refused or unsure.',
    },
    confidence: { type: Type.NUMBER },
    usedChunkIds: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    required: ['coverage', 'answer', 'confidence', 'usedChunkIds', 'refused'],
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
    case 'open_thread': {
      const title = raw.title?.trim();
      return knownChannel(raw.channelId) && title
        ? { type: 'open_thread', channelId: raw.channelId, title }
        : undefined;
    }
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
  type: 'answered' | 'low_confidence',
  payload: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await serviceClient()
    .from('bot_events')
    .insert({ guild_id: guildId, type, payload });
  if (error) throw new Error(`Could not write bot_events: ${error.message}`);
}
