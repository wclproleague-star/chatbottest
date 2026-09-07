// A date in the knowledge is a date, not a sentence.
//
// A league's knowledge holds a year of it: the spring final, the summer
// qualifiers, the autumn split. Half of that is behind us on any given day,
// and a bot that reads it back the way it is written will tell somebody in
// September that the final is on 12 April as though they should be getting
// ready for it. What it has to do instead is plain: say that one has passed,
// and name the next one that has not.
//
// So the dates in what was retrieved are read here, in the guild's own
// timezone, and handed to the model as facts about time — this one was 148
// days ago, that one is in a week — rather than left as words in a paragraph
// for it to do arithmetic on. Nothing is invented: a string that is not a date
// is not one, and a date it cannot place is left out rather than guessed.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
/** How they are usually shortened, in both languages we answer in. */
const SHORT: Record<string, number> = {
  jan: 0,
  feb: 1,
  fev: 1,
  mar: 2,
  apr: 3,
  avr: 3,
  may: 4,
  mai: 4,
  jun: 5,
  jui: 5,
  jul: 6,
  aug: 7,
  aou: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** One date found in the knowledge, and where it falls against today. */
export type Dated = {
  /** The words it was written as. */
  text: string;
  /** The day it means, YYYY-MM-DD. */
  iso: string;
  /** Whole days from today: negative is behind us. */
  away: number;
};

/** Whole days between two YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

function iso(year: number, month: number, day: number): string {
  const at = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== month) return '';
  return at.toISOString().slice(0, 10);
}

function monthOf(word: string): number {
  const lower = word.toLowerCase();
  const full = MONTHS.findIndex((m) => m === lower);
  if (full >= 0) return full;
  const short = SHORT[lower.slice(0, 3)];
  return short === undefined ? -1 : short;
}

/**
 * Every date in a piece of text, against today.
 *
 * Three ways a date is written in a server: as a date (2026-09-13), as a day
 * and a month (14 September, Sep 14, Tue 8 Sep), and with a year on the end.
 * A date written without a year means the nearest one: a league writing "8
 * Sep" in September means this September, not the one eleven months off, so
 * the closest occurrence to today is the one taken.
 */
export function datesIn(text: string, today: string): Dated[] {
  const out: Dated[] = [];
  const seen = new Set<string>();
  const add = (found: string, day: string) => {
    if (!day || seen.has(day)) return;
    const away = daysBetween(today, day);
    if (Number.isNaN(away)) return;
    seen.add(day);
    out.push({ text: found.trim(), iso: day, away });
  };

  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(match[0], iso(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  // "14 September", "14 September 2026", "Sep 14", "Tue 8 Sep". Two passes
  // rather than one pattern with two arms: a single scan reading "Tue 8" as a
  // month and a day would swallow the 8 and never see "8 Sep".
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-zéû]{3,9})\.?(?:,?\s+(\d{4}))?\b/gi;
  const monthFirst = /\b([a-zéû]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  const place = (day: number, month: number, year: string | undefined, found: string) => {
    if (!day || day > 31 || month < 0) return;
    if (year) {
      add(found, iso(Number(year), month, day));
      return;
    }
    // No year: the occurrence nearest today, looking both ways.
    const thisYear = Number(today.slice(0, 4));
    let best = '';
    let closest = Number.POSITIVE_INFINITY;
    for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
      const candidate = iso(y, month, day);
      if (!candidate) continue;
      const away = Math.abs(daysBetween(today, candidate));
      if (away < closest) {
        closest = away;
        best = candidate;
      }
    }
    add(found, best);
  };
  for (const m of text.matchAll(dayFirst)) place(Number(m[1]), monthOf(m[2] ?? ''), m[3], m[0]);
  for (const m of text.matchAll(monthFirst)) place(Number(m[2]), monthOf(m[1] ?? ''), m[3], m[0]);

  return out.sort((a, b) => a.away - b.away);
}

/** "Sunday 13 September 2026", the way a person writes one. */
export function spell(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  const month = MONTHS[at.getUTCMonth()]!;
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${month[0]!.toUpperCase()}${month.slice(1)} ${at.getUTCFullYear()}`;
}

/**
 * What the model is told about the dates it is about to answer from: which
 * are behind us, which is next. One line each, in the order they fall, so a
 * question about something in April in September is answered with "that was
 * in April" and the next thing that has not happened.
 */
export function whenLines(chunks: { content: string }[], today: string, limit = 8): string[] {
  const all: Dated[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const found of datesIn(chunk.content, today)) {
      if (seen.has(found.iso)) continue;
      seen.add(found.iso);
      all.push(found);
    }
  }
  if (all.length === 0) return [];
  const past = all.filter((d) => d.away < 0).slice(-limit);
  const ahead = all.filter((d) => d.away >= 0).slice(0, limit);
  return [...past, ...ahead].map((d) => {
    const when =
      d.away < 0
        ? `${-d.away} day${d.away === -1 ? '' : 's'} ago, so it has passed`
        : d.away === 0
          ? 'today'
          : `in ${d.away} day${d.away === 1 ? '' : 's'}`;
    return `"${d.text}" is ${spell(d.iso)}: ${when}.`;
  });
}

/** The days of the week, as members write them, in both languages. */
const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0,
  dimanche: 0,
  dim: 0,
  monday: 1,
  lundi: 1,
  lun: 1,
  tuesday: 2,
  mardi: 2,
  mar: 2,
  wednesday: 3,
  mercredi: 3,
  mer: 3,
  thursday: 4,
  jeudi: 4,
  jeu: 4,
  friday: 5,
  vendredi: 5,
  ven: 5,
  saturday: 6,
  samedi: 6,
  sam: 6,
};

/** A day named only against today: "this Sunday", "demain", "tonight". */
export type RelativeDay = { phrase: string; iso: string };

/** The day `weekday` falls on, from `today`, counting today as this one. */
function nextWeekday(today: string, weekday: number, after: boolean): string {
  const at = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  let ahead = (weekday - at.getUTCDay() + 7) % 7;
  if (after) ahead += 7;
  at.setUTCDate(at.getUTCDate() + ahead);
  return at.toISOString().slice(0, 10);
}

/** `today` shifted by whole days. */
function shift(today: string, days: number): string {
  const at = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Every day the text names against today, and the date each one means.
 *
 * A member writing "this Sunday" has said a date; it is only the bot that
 * cannot see it. Asked which date that is, Kalvard used to hand the question
 * to a moderator, which is the one thing a calendar makes unnecessary: it
 * knows today, it knows the server's timezone, and Sunday follows from both.
 */
export function relativeDays(text: string, today: string): RelativeDay[] {
  const out: RelativeDay[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, iso: string) => {
    if (!iso || seen.has(phrase.toLowerCase())) return;
    seen.add(phrase.toLowerCase());
    out.push({ phrase, iso });
  };

  const lower = text.toLowerCase();
  if (/\b(today|aujourd'hui|aujourdhui|ce soir|tonight)\b/.test(lower)) add('today', today);
  if (/\b(tomorrow|demain)\b/.test(lower)) add('tomorrow', shift(today, 1));
  if (/\b(yesterday|hier)\b/.test(lower)) add('yesterday', shift(today, -1));

  // "this Sunday", "next Sunday", "dimanche prochain", or the bare weekday.
  for (const [word, day] of Object.entries(WEEKDAY_WORDS)) {
    const at = new RegExp(`\\b(this |next |ce |ce prochain )?(${word})( prochain)?\\b`, 'i').exec(
      text,
    );
    if (!at) continue;
    const said = (at[1] ?? '').toLowerCase().trim();
    const after = said === 'next' || (at[3] ?? '').trim().length > 0;
    add(at[0].trim(), nextWeekday(today, day, after));
  }
  return out;
}

/**
 * What the model is told about the days named in front of it.
 *
 * These are facts the system supplies, like a tool result: they rest on no
 * chunk and are not claims about the server, so they are never graded and
 * never reach a moderator.
 */
export function calendarLines(text: string, today: string): string[] {
  const days = relativeDays(text, today);
  if (days.length === 0) return [];
  return [
    `Today is ${spell(today)}.`,
    ...days.filter((d) => d.iso !== today).map((d) => `"${d.phrase}" is ${spell(d.iso)}.`),
  ];
}
