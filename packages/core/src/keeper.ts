// The keeper: Kalvard as the admin of a channel where a workflow is running.
//
// In a series channel nobody pings the bot; they talk to each other. So while
// a run is alive there, every message goes past the keeper, which reads it
// with the run's brief (what Kalvard is here), the run's rules, the run's
// memory (sides, draft state, score, who reports, what it is waiting for)
// and the last few messages, and decides one of four things:
//
//   ignore    banter between players. Silence is the right answer most times.
//   answer    a question about the series or the rules, answered from what is
//             in front of it, in one or two lines.
//   escalate  something only a person decides, or a fact nothing here holds.
//   act       the message changes the run: only a moderator can, and only in
//             the ways listed (a deadline extended, a note remembered).
//
// What it may never do is invent: a fact about the series comes from memory,
// a rule from the rules, a server fact from the knowledge handed to it, and
// what none of those hold goes to the moderators. Players' words never move
// the run; moderators' do. And it does not talk much: one unprompted line a
// minute at most, never the same line twice, never a question nobody asked.

import { Type, generateJson } from './gemini';

export type KeeperInput = {
  botName: string;
  /** What Kalvard is in this channel, in the workflow's words. */
  brief: string;
  /** The rules this run enforces, one per line. */
  rules: string[];
  /** The run's memory, as short facts. */
  memory: string[];
  /** What the run is waiting for right now, and until when. */
  waiting: string | null;
  /** Chunks of the server's knowledge that bear on the message, if any. */
  knowledge: string[];
  /** The last few messages of the channel, oldest first, with who said them. */
  recent: { who: string; text: string; isBot: boolean }[];
  message: { who: string; text: string; isStaff: boolean; mentionsBot: boolean };
  /** The last thing Kalvard said unprompted here, and when, for the cadence. */
  lastSaid?: { text: string; at: string } | null;
  now?: Date;
  language?: string;
};

export type KeeperDecision = {
  decision: 'ignore' | 'answer' | 'escalate' | 'act';
  /** One or two lines, in the channel's language. Empty when ignoring. */
  reply: string;
  /** For `act`: minutes added to the current wait's deadline. Staff only. */
  extendDeadlineMinutes: number;
  /** For `act`: one short fact to remember for the rest of the run. Staff only. */
  remember: string;
  /** For the record. */
  why: string;
};

/** How long Kalvard stays quiet after speaking unprompted. */
export const QUIET_MS = 60_000;

/** The decision, with the guards that are code rather than prompt applied. */
export async function keep(input: KeeperInput): Promise<KeeperDecision> {
  const raw = await generateJson<KeeperDecision>({
    system: systemPrompt(input),
    messages: [
      {
        role: 'user',
        text: [
          'Recent messages, oldest first:',
          ...input.recent.map((m) => `${m.isBot ? `${input.botName} (you)` : m.who}: ${m.text}`),
          '',
          `New message from ${input.message.who}${input.message.isStaff ? ' (staff)' : ''}${input.message.mentionsBot ? ', addressed to you' : ''}:`,
          input.message.text,
        ].join('\n'),
      },
    ],
    schema: {
      type: Type.OBJECT,
      properties: {
        decision: { type: Type.STRING, enum: ['ignore', 'answer', 'escalate', 'act'] },
        reply: { type: Type.STRING },
        extendDeadlineMinutes: { type: Type.NUMBER },
        remember: { type: Type.STRING },
        why: { type: Type.STRING },
      },
      required: ['decision', 'reply', 'extendDeadlineMinutes', 'remember', 'why'],
      propertyOrdering: ['decision', 'reply', 'extendDeadlineMinutes', 'remember', 'why'],
    },
    temperature: 0.2,
    maxOutputTokens: 400,
  });
  return guard(raw, input);
}

/** What is not trusted to the model. */
export function guard(raw: KeeperDecision, input: KeeperInput): KeeperDecision {
  const out: KeeperDecision = {
    decision: (['ignore', 'answer', 'escalate', 'act'] as const).includes(raw.decision)
      ? raw.decision
      : 'ignore',
    reply: String(raw.reply ?? '').trim(),
    extendDeadlineMinutes: Math.max(
      0,
      Math.min(120, Math.round(Number(raw.extendDeadlineMinutes) || 0)),
    ),
    remember: String(raw.remember ?? '')
      .trim()
      .slice(0, 200),
    why: String(raw.why ?? '')
      .trim()
      .slice(0, 200),
  };

  // Only a moderator moves the run. A player asking for fifteen more minutes
  // gets the rule and the moderators, never the minutes.
  if (out.decision === 'act' && !input.message.isStaff) {
    out.decision = 'escalate';
    out.extendDeadlineMinutes = 0;
    out.remember = '';
    if (!out.reply) out.reply = 'That is for staff to approve.';
  }
  if (out.decision !== 'act') {
    out.extendDeadlineMinutes = 0;
    out.remember = '';
  }
  // Two lines at most. A keeper that lectures is a bot in the chat.
  if (out.reply) {
    const lines = out.reply.split(/\n+/).filter(Boolean);
    out.reply = lines.slice(0, 2).join('\n').slice(0, 400);
  }
  // Never the same thing twice, and not more than one unprompted line a minute.
  const now = (input.now ?? new Date()).getTime();
  const last = input.lastSaid ?? null;
  const unprompted = !input.message.mentionsBot && out.decision === 'answer';
  if (out.reply && last && normalise(last.text) === normalise(out.reply)) {
    out.decision = 'ignore';
    out.reply = '';
    out.why = `${out.why} (already said)`.trim();
  } else if (unprompted && last && now - new Date(last.at).getTime() < QUIET_MS) {
    out.decision = 'ignore';
    out.reply = '';
    out.why = `${out.why} (spoke less than a minute ago)`.trim();
  }
  if (out.decision === 'ignore') out.reply = '';
  if ((out.decision === 'answer' || out.decision === 'escalate') && !out.reply) {
    out.decision = 'ignore';
  }
  return out;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function systemPrompt(input: KeeperInput): string {
  return [
    `You are ${input.botName}, the admin present in a Discord channel where a routine is running. ${input.brief}`,
    'You read every message. Most are players talking to each other, and the right thing is to say nothing: decision "ignore".',
    'Answer when somebody asks something you can answer from what is below — the state of the series, the rules, a fact from the knowledge — or when they are clearly stuck and one line would unstick them. One or two short lines, like a person at the table, never a paragraph, never a list, never "as an AI".',
    'Never state a fact about the series that is not in the memory, a rule that is not in the rules, or a fact about the server that is not in the knowledge. What none of those hold, and only a person can decide — a dispute, a forfeit, an exception to a rule — is decision "escalate": say in one line that staff has to decide, and the caller brings them in.',
    'A player asking for more time, a pause or an exception gets the rule as written and "escalate", never the exception itself. Only a message marked (staff) may change the run: decision "act", with extendDeadlineMinutes for time granted and remember for a fact to keep, plus one line acknowledging it.',
    'Do not repeat what you already said. Do not ask questions nobody needs answered. Do not greet, thank, or sign off.',
    input.language ? `Write in ${input.language}.` : 'Write in the language the channel is using.',
    '',
    'Rules of this routine:',
    ...(input.rules.length > 0 ? input.rules.map((r) => `- ${r}`) : ['- (none written)']),
    '',
    'Memory of this run:',
    ...(input.memory.length > 0 ? input.memory.map((m) => `- ${m}`) : ['- (nothing yet)']),
    input.waiting
      ? `Right now it is waiting for: ${input.waiting}`
      : 'Right now it is not waiting for anything.',
    '',
    'Server knowledge that may bear on this message:',
    ...(input.knowledge.length > 0
      ? input.knowledge.map((k) => `- ${k}`)
      : ['- (nothing relevant)']),
  ].join('\n');
}

/**
 * The run's variables as short facts a model can read. Only what a member of
 * the channel could see anyway: names, sides, states, the score. Never ids.
 */
export function memoryOf(variables: Record<string, unknown>): string[] {
  const v = variables;
  const name = (x: unknown): string =>
    x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string'
      ? (x as { name: string }).name
      : '';
  const out: string[] = [];
  const a = name(v.teamA);
  const b = name(v.teamB);
  if (a && b)
    out.push(`Series: ${a} vs ${b}, best of three, first to ${String(v.winsNeeded ?? 2)} wins.`);
  if (v.game) out.push(`Current game: ${String(v.game)}.`);
  const blue = name(v.blue);
  const red = name(v.red);
  if (blue && red) out.push(`Sides this game: ${blue} blue, ${red} red.`);
  if (a && b && (v.winsA !== undefined || v.winsB !== undefined)) {
    out.push(`Score: ${a} ${String(v.winsA ?? 0)} - ${String(v.winsB ?? 0)} ${b}.`);
  }
  const draft = v.draft as
    { status?: string; game?: number; blueUrl?: string; redUrl?: string } | undefined;
  if (draft && typeof draft === 'object') {
    const status =
      draft.status === 'done'
        ? 'finished'
        : draft.status === 'drafting'
          ? 'in progress'
          : 'open, nobody has picked yet';
    out.push(`Draft for this game: ${status}.`);
    if (draft.blueUrl && draft.redUrl && draft.status !== 'done') {
      out.push(
        `Draft links were posted in the channel: blue ${draft.blueUrl}, red ${draft.redUrl}.`,
      );
    }
  }
  if (typeof v.reporter === 'string' && v.reporter) {
    out.push(
      'One member already reports the screenshots for this series; only they may send them.',
    );
  }
  const notes = Array.isArray(v._notes) ? (v._notes as unknown[]).map(String) : [];
  for (const note of notes.slice(-5)) out.push(`Staff noted: ${note}`);
  if (typeof v.rules === 'string' && v.rules) out.push(`Rules read at the start: ${v.rules}`);
  return out;
}
