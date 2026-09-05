// The answer loop. A mention starts a turn; the model may call tools before it
// replies, and the turn ends in one of four ways: it replies, it asks the
// member something and waits, it assigns a role it verified, or it hands the
// question to a moderator with a summary of what it tried.
//
// What the loop may do is bounded, not trusted. Reads are free. Writes go
// through the guild's allowlist, and a role is only ever assigned after the
// proof configured for that role has passed in this same turn: a failed check
// is never forced, it escalates. At most five tool calls, then the turn must
// end.
//
// Anything the loop does not need a tool for is still the single-shot
// contract in answer.ts, so an informational reply is graded the same way and
// an ungrounded fact is still hedged or handed over rather than asserted.

import { answer } from './answer';
import type { AnswerResult, HistoryTurn } from './answer';
import { generateJson, generateWithTools } from './gemini';
import type { FunctionDeclaration, ToolTurn } from './gemini';
import { Type } from './gemini';
import { serviceClient } from './supabase';
import { MODS } from './tokens';

/** How many tool calls one turn may make. */
export const MAX_TOOL_CALLS = 5;
/** How long a conversation stays open, waiting for the member to answer. */
export const CONVERSATION_TTL_MS = 30 * 60 * 1000;

export type RoleProof =
  | { kind: 'roster_document'; documentId: string }
  | { kind: 'channel_access'; channelId: string }
  | { kind: 'has_role'; roleId: string };

/** What the bot can actually do in Discord. The loop asks; these carry it out. */
export type Effects = {
  /** The self-serve roles of this guild, by id and name. */
  listRoles(): Promise<{ id: string; name: string }[]>;
  /** Whether the member is in that channel; for `channel_access` proofs. */
  memberInChannel(userId: string, channelId: string): Promise<boolean>;
  /** Whether the member holds that role; for `has_role` proofs. */
  memberHasRole(userId: string, roleId: string): Promise<boolean>;
  /** Give the member the role. Only ever called after a proof passed. */
  assignRole(userId: string, roleId: string): Promise<void>;
  /** A channel's name, for pointing at it by name. */
  channelName(channelId: string): Promise<string | null>;
};

export type ConversationInput = {
  guildId: string;
  /** Channel and user, so a reply continues the same turn. */
  conversationId: string;
  userId: string;
  askerName?: string;
  message: string;
  channelId?: string;
  /** Who is asking and where, forwarded to the graded reply for resolution. */
  asker?: { nickname?: string; roles?: string[]; isStaff?: boolean };
  channel?: { name?: string; category?: string; topic?: string };
  /** The recent messages of the channel, when this is the first turn. */
  history?: HistoryTurn[];
  effects: Effects;
};

/** What the bot should do when the turn ends. */
export type ConversationResult =
  | { outcome: 'reply'; text: string; steps: string[]; graded?: AnswerResult }
  | { outcome: 'ask'; text: string; steps: string[] }
  | { outcome: 'assigned'; text: string; roleId: string; steps: string[] }
  | { outcome: 'escalate'; text: string; summary: string; steps: string[] };

// The conversation each member has open, if any. In memory: one bot process
// serves every guild, and a dropped conversation only costs the member a
// repeated sentence.
type Conversation = { turns: ToolTurn[]; updatedAt: number; language?: string };
const conversations = new Map<string, Conversation>();

function loadConversation(id: string): ToolTurn[] {
  const found = conversations.get(id);
  if (!found) return [];
  if (Date.now() - found.updatedAt > CONVERSATION_TTL_MS) {
    conversations.delete(id);
    return [];
  }
  return found.turns;
}

function saveConversation(id: string, turns: ToolTurn[], language?: string): void {
  conversations.set(id, { turns, updatedAt: Date.now(), language });
  // Drop whatever else has gone cold, so the map cannot grow without bound.
  for (const [key, value] of conversations) {
    if (Date.now() - value.updatedAt > CONVERSATION_TTL_MS) conversations.delete(key);
  }
}

/** Ends the conversation: the member got what they asked for, or a moderator has it. */
function closeConversation(id: string): void {
  conversations.delete(id);
}

/**
 * Whether Sentry is waiting on this member here. It only waits after asking
 * them something, so their next message is the answer to it, mention or not.
 */
export function hasOpenConversation(id: string): boolean {
  return loadConversation(id).length > 0;
}

export async function converse(input: ConversationInput): Promise<ConversationResult> {
  const { guildId, conversationId, userId, effects } = input;
  const settings = await loadAgentSettings(guildId);
  const earlier = loadConversation(conversationId);
  const turns: ToolTurn[] = [
    ...earlier,
    {
      role: 'user',
      text: input.askerName ? `${input.askerName}: ${input.message}` : input.message,
    },
  ];

  // The language is the member's, for the whole conversation, unless the
  // owner has forced one. Held rather than re-judged, so it cannot drift.
  const language =
    settings.language ??
    conversations.get(conversationId)?.language ??
    (await detectLanguage(input.message));

  const steps: string[] = [];
  // A role may only be assigned after its own proof passed in this turn.
  const proven = new Set<string>();
  // The role this turn gave out, if any; the loop reports it once it is done.
  let assigned: string | null = null;
  // Each correction is offered once; a second time it is not worth the round trip.
  let nagged = false;
  let guessed = false;
  let calls = 0;

  while (calls <= MAX_TOOL_CALLS) {
    const budget = MAX_TOOL_CALLS - calls;
    const step = await generateWithTools({
      system: systemPrompt(settings, budget, language),
      turns,
      tools: TOOLS,
    });

    if (step.calls.length === 0) {
      // Something was given out: that is what the turn was, whatever the
      // confirmation happens to end with.
      if (assigned) {
        closeConversation(conversationId);
        return {
          outcome: 'assigned',
          text: await inLanguage(step.text || 'Done.', language),
          roleId: assigned,
          steps,
        };
      }

      // A question, or a list of things to choose from, keeps the conversation
      // open: the member's next message is the answer to it, not a new request.
      const offersChoice = (await effects.listRoles()).filter((r) => mentions(step.text, r.name));
      if (step.text.trim().endsWith('?') || offersChoice.length > 1) {
        turns.push({ model: step.content });
        saveConversation(conversationId, turns, language);
        return { outcome: 'ask', text: await inLanguage(step.text, language), steps };
      }

      // It said it was about to do something and then did nothing. Saying is
      // not doing: send it back round to actually do it.
      if (!assigned && !nagged && (await announcesAction(step.text))) {
        nagged = true;
        turns.push({ model: step.content });
        turns.push({
          role: 'tool',
          name: 'do_it',
          result: {
            ok: false,
            reason:
              'You told the member what you were about to do without doing it. Never announce an action: call the tool now, in this turn, and then report what happened, or say plainly that you cannot and why.',
          },
        });
        continue;
      }
      closeConversation(conversationId);
      // A plain informational reply to a fresh question goes through the
      // grading contract rather than being posted as the model wrote it. Mid
      // conversation it does not: the context is here, not in one message.
      if (steps.length === 0 && earlier.length === 0) {
        const graded: AnswerResult = await answer({
          guildId,
          question: input.message,
          askerName: input.askerName,
          channelId: input.channelId,
          history: earlier.length > 0 ? undefined : input.history,
          asker: input.asker,
          channel: input.channel,
        });
        return {
          outcome: 'reply',
          text: await inLanguage(replyOf(graded), language),
          steps,
          graded,
        };
      }
      return { outcome: 'reply', text: await inLanguage(step.text || 'Done.', language), steps };
    }

    const call = step.calls[0]!;
    // The role is already given: whatever it wants to do next, the member is
    // told what happened rather than asked something else.
    if (assigned && call.name === 'ask_user') {
      closeConversation(conversationId);
      const said = String(call.args.question ?? step.text ?? '').trim();
      return {
        outcome: 'assigned',
        text: await inLanguage(said || 'Done.', language),
        roleId: assigned,
        steps,
      };
    }
    calls++;
    turns.push({ model: step.content });

    switch (call.name) {
      case 'ask_user': {
        const question = String(call.args.question ?? '').trim();
        const offered = await effects.listRoles();
        if (!guessed && guessesOneRole(question, turns, offered)) {
          guessed = true;
          turns.push({
            role: 'tool',
            name: call.name,
            result: {
              ok: false,
              reason:
                'The member has not named a role, so do not put one to them as though they had. Ask which one they want and name every role you can give out: ' +
                offered.map((r) => r.name).join(', '),
            },
          });
          break;
        }
        // The question is kept, so a later turn can tell what was confirmed.
        turns.push({
          role: 'tool',
          name: call.name,
          result: `asked: "${question}"; waiting for the member`,
        });
        saveConversation(conversationId, turns, language);
        return { outcome: 'ask', text: await inLanguage(question || step.text, language), steps };
      }

      case 'escalate_to_mod': {
        const summary = String(call.args.summary ?? '').trim();
        closeConversation(conversationId);
        const text = String(call.args.message ?? '').trim() || `I can't do that one. ${MODS}`;
        const withMods = text.includes(MODS) ? text : `${text} ${MODS}`;
        return { outcome: 'escalate', text: await inLanguage(withMods, language), summary, steps };
      }

      case 'search_knowledge': {
        const query = String(call.args.query ?? input.message);
        const found = await searchKnowledge(guildId, query, settings.threshold);
        steps.push(`searched the knowledge for "${query}"`);
        turns.push({ role: 'tool', name: call.name, result: found });
        break;
      }

      case 'list_roles': {
        const roles = await effects.listRoles();
        steps.push('listed the roles it can give out');
        turns.push({ role: 'tool', name: call.name, result: roles });
        break;
      }

      case 'check_membership': {
        const roleId = String(call.args.roleId ?? '');
        const proof = settings.roleProofs[roleId];
        const result = await checkMembership({ guildId, userId, roleId, proof, effects });
        if (result.ok) proven.add(roleId);
        steps.push(`checked whether they may have that role: ${result.reason}`);
        turns.push({ role: 'tool', name: call.name, result });
        break;
      }

      case 'assign_role': {
        const roleId = String(call.args.roleId ?? '');
        const allowed = settings.selfServeRoleIds.includes(roleId);
        if (!allowed) {
          turns.push({
            role: 'tool',
            name: call.name,
            result: { ok: false, reason: 'that role is not one the owner lets me give out' },
          });
          break;
        }
        const roles = await effects.listRoles();
        const roleName = roles.find((r) => r.id === roleId)?.name ?? '';
        // Either they asked for this role themselves, or they agreed to it
        // when Sentry proposed it. Agreement is judged on its own, because a
        // member who disputes a guess repeats the name too, and the model
        // running the conversation is a poor judge of whether it was heard.
        const requested = askedForItself(turns, roleName);
        const agreed =
          requested ||
          (await memberAgreed(input.message, questionsAsked(turns).at(-1) ?? '', roleName));
        if (!agreed) {
          turns.push({
            role: 'tool',
            name: call.name,
            result: {
              ok: false,
              needsConfirmation: true,
              roleName,
              reason: `The member has not agreed to be given "${roleName}". Repeating a name, correcting you or sounding unsure is not agreement. This is not a failure and not for the moderators: ask them plainly whether they want "${roleName}", and assign it only if they say yes.`,
            },
          });
          break;
        }
        if (!proven.has(roleId)) {
          // Never forced: without a passed check there is nothing to stand on.
          turns.push({
            role: 'tool',
            name: call.name,
            result: {
              ok: false,
              reason: 'check_membership has not passed for this role in this conversation',
            },
          });
          break;
        }
        await effects.assignRole(userId, roleId);
        steps.push('gave them the role');
        assigned = roleId;
        // The write is a tool like any other: the loop goes round once more so
        // the member is told it is done, in their own language, rather than
        // being left with the narration that preceded it.
        turns.push({
          role: 'tool',
          name: call.name,
          result: { ok: true, role: roleName, note: 'Tell them it is done, in one short line.' },
        });
        break;
      }

      case 'point_to_channel': {
        const channelId = String(call.args.channelId ?? '');
        const name = await effects.channelName(channelId);
        turns.push({
          role: 'tool',
          name: call.name,
          result: name ? { channel: `<#${channelId}>` } : { error: 'no such channel' },
        });
        break;
      }

      default:
        turns.push({ role: 'tool', name: call.name, result: { error: 'no such tool' } });
    }
  }

  // Out of calls: hand it over rather than keep trying.
  closeConversation(conversationId);
  return {
    outcome: 'escalate',
    text: await inLanguage(`I couldn't finish that one on my own. ${MODS}`, language),
    summary: `Tried ${MAX_TOOL_CALLS} steps for "${input.message}": ${steps.join('; ') || 'nothing worked'}.`,
    steps,
  };
}

/** Lowercase, without accents, so "rôle" and "role" compare the same. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Whether a name appears as a name, not as letters inside another word. Role
 * names are often two letters, and "EU" sits inside "veux".
 */
function mentions(text: string, name: string): boolean {
  const escaped = normalise(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(normalise(text));
}

/**
 * Every question Sentry has put to the member in this conversation, whether it
 * went through ask_user or was simply written as a question.
 */
function questionsAsked(turns: ToolTurn[]): string[] {
  const out: string[] = [];
  for (const turn of turns) {
    if ('model' in turn) {
      const parts = (turn.model.parts ?? []) as { text?: string }[];
      const text = parts
        .map((p) => p.text ?? '')
        .join(' ')
        .trim();
      if (text.endsWith('?')) out.push(text);
    } else if (turn.role === 'tool' && turn.name === 'ask_user') {
      out.push(String(turn.result));
    }
  }
  return out;
}

/**
 * Whether the member asked for this role before Sentry ever mentioned it. Only
 * their own request counts here; anything they say after Sentry names a role
 * is an answer to Sentry, and answers are judged, not pattern-matched.
 */
function askedForItself(turns: ToolTurn[], roleName: string): boolean {
  if (!roleName) return false;
  for (const turn of turns) {
    if ('model' in turn) return false;
    if (turn.role === 'tool') return false;
    if (turn.role === 'user' && mentions(turn.text, roleName)) return true;
  }
  return false;
}

/**
 * Did the member actually agree to be given this role? Judged on its own, at
 * temperature zero, because saying the name is not the same as asking for it.
 */
async function memberAgreed(latest: string, question: string, roleName: string): Promise<boolean> {
  if (!roleName) return false;
  try {
    const out = await generateJson<{ agreed: boolean; reason: string }>({
      system: [
        'You decide one thing: has this member agreed to be given the role named below?',
        'Only a clear yes counts: they ask for it by name, accept it, or confirm it.',
        'These are not agreement: repeating the name back, correcting you, disputing what you said, asking a question, sounding unsure, or joking.',
        'Nor is naming it by initials or a shortened form: "FF" for "Fast Forward" is a guess at what they mean, so say no and let it be confirmed.',
        'When it is not clear, say no.',
        'Answer in any language the member may have written in.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          text: `Role: ${roleName}\nSentry asked: ${question || '(nothing)'}\nThe member replied: ${latest}`,
        },
      ],
      schema: {
        type: Type.OBJECT,
        properties: { agreed: { type: Type.BOOLEAN }, reason: { type: Type.STRING } },
        required: ['agreed', 'reason'],
        propertyOrdering: ['agreed', 'reason'],
      },
      temperature: 0,
    });
    return out.agreed === true;
  } catch {
    // Unable to tell means no: a role given wrongly costs more than one more question.
    return false;
  }
}

/** The language a message is written in, as an English name: "French", "English". */
async function detectLanguage(text: string): Promise<string> {
  try {
    const out = await generateJson<{ language: string }>({
      system:
        'Name the language this message is written in, in English, as one word. If it is too short to tell, say English.',
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { language: { type: Type.STRING } },
        required: ['language'],
      },
      temperature: 0,
    });
    return out.language?.trim() || 'English';
  } catch {
    return 'English';
  }
}

/**
 * The text, in the language this conversation is held in. Checked rather than
 * hoped for: a reply that drifts into another language is rewritten before it
 * is sent.
 */
async function inLanguage(text: string, language: string): Promise<string> {
  if (!text.trim()) return text;
  try {
    const out = await generateJson<{ ok: boolean; rewritten: string }>({
      system: [
        `Is this message written in ${language}?`,
        'If it is, ok is true and rewritten is empty.',
        `If it is not, ok is false and rewritten is the same message in ${language}, keeping its meaning, its tone and anything in braces such as {mods} exactly as it is.`,
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { ok: { type: Type.BOOLEAN }, rewritten: { type: Type.STRING } },
        required: ['ok', 'rewritten'],
        propertyOrdering: ['ok', 'rewritten'],
      },
      temperature: 0,
    });
    return out.ok ? text : out.rewritten.trim() || text;
  } catch {
    return text;
  }
}

/** Whether a message says an action is coming rather than reporting one that happened. */
async function announcesAction(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    const out = await generateJson<{ announces: boolean }>({
      system: [
        'Does this message say the writer is about to do something, rather than reporting something already done?',
        '"Let me assign you the role", "je vais te donner le rôle", "I will check" are announcements: true.',
        '"Done, you have the role", "I could not find you on the roster", "the bracket is on Sunday" are not: false.',
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { announces: { type: Type.BOOLEAN } },
        required: ['announces'],
      },
      temperature: 0,
    });
    return out.announces === true;
  } catch {
    return false;
  }
}

/** The first letters of each word: "Fast Forward" becomes "ff". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('');
}

/**
 * Whether a question puts one role to the member that they never named, while
 * others were on offer. That is a guess dressed as a question.
 */
function guessesOneRole(
  question: string,
  turns: ToolTurn[],
  roles: { id: string; name: string }[],
): boolean {
  if (roles.length < 2) return false;
  const said = turns.map((t) => ('role' in t && t.role === 'user' ? t.text : '')).join(' ');
  // Anything that points at a role counts: its name, one of its words, or its
  // initials. "FF" is the member gesturing at Fast Forward, not saying nothing.
  const gestured = roles.some(
    (r) =>
      mentions(said, r.name) ||
      mentions(said, initials(r.name)) ||
      r.name.split(/\s+/).some((word) => word.length > 2 && mentions(said, word)),
  );
  if (gestured) return false;
  return roles.filter((r) => mentions(question, r.name)).length === 1;
}

/** The proof this guild configured for the role, run against the member. */
async function checkMembership(input: {
  guildId: string;
  userId: string;
  roleId: string;
  proof: RoleProof | undefined;
  effects: Effects;
}): Promise<{ ok: boolean; reason: string }> {
  const { proof, effects, userId } = input;
  if (!proof) {
    return { ok: false, reason: 'no proof is configured for that role, so I cannot verify it' };
  }
  switch (proof.kind) {
    case 'has_role': {
      const ok = await effects.memberHasRole(userId, proof.roleId);
      return ok
        ? { ok: true, reason: 'they hold the role that qualifies them' }
        : { ok: false, reason: 'they do not hold the role that qualifies them' };
    }
    case 'channel_access': {
      const ok = await effects.memberInChannel(userId, proof.channelId);
      return ok
        ? { ok: true, reason: 'they have access to the channel that qualifies them' }
        : { ok: false, reason: 'they cannot see the channel that qualifies them' };
    }
    case 'roster_document': {
      const name = await memberName(input.guildId, userId);
      const { data } = await serviceClient()
        .from('documents')
        .select('raw_text')
        .eq('id', proof.documentId)
        .maybeSingle();
      const roster = (data?.raw_text ?? '').toLowerCase();
      if (!roster) return { ok: false, reason: 'the roster document is empty or missing' };
      const ok = Boolean(name && roster.includes(name.toLowerCase()));
      return ok
        ? { ok: true, reason: 'they are on the roster' }
        : { ok: false, reason: 'they are not on the roster' };
    }
  }
}

/** The name the roster would list them under. Set by the caller through the conversation. */
const memberNames = new Map<string, string>();
export function rememberMemberName(guildId: string, userId: string, name: string): void {
  memberNames.set(`${guildId}:${userId}`, name);
}
async function memberName(guildId: string, userId: string): Promise<string | null> {
  return memberNames.get(`${guildId}:${userId}`) ?? null;
}

async function searchKnowledge(
  guildId: string,
  query: string,
  threshold: number,
): Promise<{ id: string; content: string }[]> {
  const { embed } = await import('./gemini');
  const [vector] = await embed([query], 'RETRIEVAL_QUERY');
  if (!vector) return [];
  const { data } = await serviceClient().rpc('match_chunks', {
    guild_id: guildId,
    query_embedding: JSON.stringify(vector),
    match_count: 6,
    min_similarity: threshold,
  });
  return (data ?? []).map((m) => ({ id: m.id, content: m.content }));
}

type AgentSettings = {
  botName: string;
  persona: string | null;
  language: string | null;
  threshold: number;
  selfServeRoleIds: string[];
  roleProofs: Record<string, RoleProof>;
};

async function loadAgentSettings(guildId: string): Promise<AgentSettings> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  return {
    botName: data?.bot_name || 'Sentry',
    persona: data?.persona_prompt ?? null,
    language: data?.language ?? null,
    threshold: data?.confidence_threshold ?? 0.55,
    selfServeRoleIds: data?.self_serve_role_ids ?? [],
    roleProofs: (data?.role_proofs ?? {}) as Record<string, RoleProof>,
  };
}

function replyOf(result: AnswerResult): string {
  switch (result.tier) {
    case 'answer':
      return result.answer;
    case 'clarify':
      return result.question;
    case 'partial':
    case 'none':
      return result.reply;
    case 'flagged':
      return '';
  }
}

function systemPrompt(s: AgentSettings, budget: number, language: string): string {
  return [
    `You are ${s.botName}, the assistant for a Discord server. You are talking to a member in a channel, in character, in your own words.`,
    s.persona ?? '',
    `Write every message in ${language}: the answer, any question you ask, and the confirmation. This does not change during the conversation.`,
    '',
    'You have tools. Use them when the member wants something done; answer plainly when they just want to talk or to know something.',
    '- Say what you are doing as you do it, in one short line, in character: "let me check you are on the team".',
    '- Never claim a fact about this server unless a tool gave it to you.',
    '- Before giving anyone a role you must call check_membership for that role and it must pass. If it fails, do not try another way and do not give the role: call escalate_to_mod with what you tried.',
    '- If you do not know which role, channel or thing the member means, call ask_user with one short question and stop. When you ask which role, name every role you can give out, so they can choose from what exists rather than guess.',
    '- A tool that comes back asking you to confirm something is not a failure and is not for the moderators: ask the member, then try again. Escalate only when something is genuinely refused or verification fails.',
    '- Consent to a write is an explicit yes to the exact thing. A member who sounds confused, corrects you, questions what you said, or merely repeats a name back at you has not agreed to anything: ask again, plainly, and wait. Never read a correction as agreement. "hein, mais j\'ai parlé de X" is someone disputing you, not asking for X.',
    '- Do not put one option to them as though it were what they said. If they have not named a thing, ask which one, and name everything on offer.',
    '- Never say what you are about to do. Do it in this turn and report what happened: "Done, you have the Fast Forward role", or why it did not work. "Let me check" is only ever said alongside the check itself.',
    '- When the member confirms the thing you just asked them about, act on it there and then. Do not ask the same question again in other words.',
    '- Confirm before you act on a name the member did not write in full. Initials, an abbreviation, a nickname or a partial name all need one short ask_user first ("FF, you mean Fast Forward?"), even when only one role could match. Act straight away only when they wrote the role name as it is.',
    `- You have ${budget} tool call(s) left in this turn. When they run out you must escalate_to_mod.`,
    '',
    'When you have nothing left to do, reply to the member in one or two short sentences.',
  ]
    .filter(Boolean)
    .join('\n');
}

const TOOLS: FunctionDeclaration[] = [
  {
    name: 'search_knowledge',
    description:
      'Search what this server has told you. Use it before stating any fact about the server.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
    },
  },
  {
    name: 'list_roles',
    description: 'The roles you are allowed to give out on this server, with their ids and names.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'check_membership',
    description:
      'Whether this member is allowed to have a role, by the proof the owner configured for it. Must pass before assign_role.',
    parameters: {
      type: Type.OBJECT,
      properties: { roleId: { type: Type.STRING } },
      required: ['roleId'],
    },
  },
  {
    name: 'assign_role',
    description: 'Give the member a role. Only works after check_membership passed for that role.',
    parameters: {
      type: Type.OBJECT,
      properties: { roleId: { type: Type.STRING } },
      required: ['roleId'],
    },
  },
  {
    name: 'point_to_channel',
    description: 'Get a mention for a channel, to tell the member where something happens.',
    parameters: {
      type: Type.OBJECT,
      properties: { channelId: { type: Type.STRING } },
      required: ['channelId'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the member one short question and wait for their reply. Ends your turn.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: "One short question, written in the member's language.",
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'escalate_to_mod',
    description:
      "Hand this to the moderators. 'message' is the one line the member sees, in their language; 'summary' is for the moderators and says what you tried and why it did not work. Ends your turn.",
    parameters: {
      type: Type.OBJECT,
      properties: { message: { type: Type.STRING }, summary: { type: Type.STRING } },
      required: ['summary'],
    },
  },
];
