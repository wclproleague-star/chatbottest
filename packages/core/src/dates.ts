// "This Sunday" is only true for a week.
//
// A moderator answers in the words they would use to a person: this Sunday,
// tomorrow, next week, in two days. Written down as they said it, that answer
// is wrong seven days later and there is nothing in it to be wrong about — the
// bot can only repeat the phrase back, which is what it did: asked which date,
// it said "this Sunday" again.
//
// So before a moderator's answer becomes knowledge, the relative parts of it
// are turned into dates. The model reads the sentence against today's date in
// the guild's own timezone; the code then refuses anything it cannot verify:
// a date that is not the weekday it was called, or one outside a sane window,
// is left exactly as the moderator wrote it rather than guessed at.

import { Type, generateJson } from './gemini';

/** One phrase, and the day it turns out to mean. */
export type ResolvedDate = {
  /** The words the moderator used: "this Sunday". */
  phrase: string;
  /** The day, as YYYY-MM-DD. */
  iso: string;
  /** The same, as a person writes it: "Sunday 14 September". */
  readable: string;
};

export type Resolution = {
  /** The answer with each phrase replaced by the day it means. */
  rewritten: string;
  /** What was resolved, for the line that confirms it. */
  changes: ResolvedDate[];
};

/** How far from today a resolved date may fall before it is not believed. */
const BACK_DAYS = 400;
const FORWARD_DAYS = 400;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Today where the guild lives, as YYYY-MM-DD and the day it is called. */
export function todayIn(now: Date, timezone: string | null): { iso: string; weekday: string } {
  const zone = timezone || 'UTC';
  try {
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(
      now,
    );
    return { iso, weekday };
  } catch {
    return { iso: now.toISOString().slice(0, 10), weekday: DAYS[now.getUTCDay()]! };
  }
}

/** "2026-09-13" -> "Sunday 13 September". Empty when the date is not one. */
export function readableDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return '';
  const [, y, m, d] = match;
  const at = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(at.getTime())) return '';
  if (at.getUTCMonth() !== Number(m) - 1) return '';
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** Whole days between two YYYY-MM-DD, positive when the second is later. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/**
 * What the code will accept from the model, whatever it says.
 *
 * A phrase that names a weekday must resolve to that weekday: "this Sunday"
 * landing on a Tuesday is the model doing arithmetic badly, and a wrong date
 * written into the knowledge is worse than a vague one. A date more than a
 * year away is not what anybody meant by "this Sunday" either. And the phrase
 * has to be in the sentence, or there is nothing to replace.
 */
export function believable(
  change: { phrase: string; iso: string },
  text: string,
  today: string,
): boolean {
  const readable = readableDay(change.iso);
  if (!readable) return false;
  if (!change.phrase.trim() || !text.toLowerCase().includes(change.phrase.trim().toLowerCase())) {
    return false;
  }
  const away = daysBetween(today, change.iso);
  if (Number.isNaN(away) || away < -BACK_DAYS || away > FORWARD_DAYS) return false;
  const named = DAYS.find((day) => new RegExp(day, 'i').test(change.phrase));
  if (named && !readable.startsWith(named)) return false;
  return true;
}

/**
 * The answer with its relative days written out. Nothing found, or nothing
 * believable, gives the answer back untouched: this never guesses, and it
 * never rewrites a sentence it did not understand.
 */
export async function resolveDates(
  text: string,
  now: Date,
  timezone: string | null,
): Promise<Resolution> {
  const said = text.trim();
  if (!said) return { rewritten: text, changes: [] };
  const today = todayIn(now, timezone);

  let raw: { changes?: { phrase: string; iso: string }[] };
  try {
    raw = await generateJson<{ changes: { phrase: string; iso: string }[] }>({
      system: [
        `Today is ${today.weekday} ${today.iso}, where this Discord server lives${timezone ? ` (${timezone})` : ''}.`,
        'Find every part of the message that names a day only in relation to today — this Sunday, next Friday, tomorrow, in two weeks, tonight — and say which calendar day each one means.',
        'phrase is the words exactly as they appear in the message, nothing more. iso is that day as YYYY-MM-DD.',
        '"this <weekday>" is the next one that has not happened yet, today included. "next <weekday>" is the one after that.',
        'A day already written as a date is not a relative phrase and is left alone. Return an empty list when there is nothing relative in the message.',
      ].join(' '),
      messages: [{ role: 'user', text: said }],
      schema: {
        type: Type.OBJECT,
        properties: {
          changes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { phrase: { type: Type.STRING }, iso: { type: Type.STRING } },
              required: ['phrase', 'iso'],
              propertyOrdering: ['phrase', 'iso'],
            },
          },
        },
        required: ['changes'],
        propertyOrdering: ['changes'],
      },
      temperature: 0,
      maxOutputTokens: 300,
    });
  } catch {
    return { rewritten: text, changes: [] };
  }

  const changes: ResolvedDate[] = [];
  let rewritten = said;
  for (const change of raw.changes ?? []) {
    if (!believable(change, said, today.iso)) continue;
    const readable = readableDay(change.iso);
    // Once only, and only where it still stands: two phrases may overlap.
    const at = rewritten.toLowerCase().indexOf(change.phrase.trim().toLowerCase());
    if (at < 0) continue;
    rewritten =
      rewritten.slice(0, at) + readable + rewritten.slice(at + change.phrase.trim().length);
    changes.push({ phrase: change.phrase.trim(), iso: change.iso, readable });
  }
  return { rewritten, changes };
}

/** The one line that puts the dates back to the moderator before they are kept. */
export function confirmLine(changes: ResolvedDate[]): string {
  if (changes.length === 0) return '';
  const each = changes.map((c) => `${c.phrase} is ${c.readable}`).join(', and ');
  return `Pinning that down: ${each}? Tick it and that is what I will remember.`;
}
