// When a scheduled workflow is due.
//
// A schedule is written the way somebody says it — "every Thursday at 18:00",
// "every day at 09:00" — and read here into a time. Two rules make this safe
// to run unattended.
//
// It is never guessed at. A phrase this does not understand returns null, the
// workflow simply does not run on its own, and the dashboard says so. A
// routine that fires at the wrong hour because a parser was generous is worse
// than one that never fires.
//
// And it looks backwards, not forwards: given now, it answers what the most
// recent due moment was. A worker that was asleep at 18:00 and wakes at 18:04
// still finds Thursday's run, and the claim on that exact timestamp is what
// stops it running twice.

/** Days as the phrase writes them, in the order Date.getUTCDay uses. */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number };

/** Reads a phrase, or nothing when it is not one this understands. */
export function readSchedule(when: string | undefined): Schedule | null {
  if (!when) return null;
  const text = when.trim().toLowerCase();
  const time = text.match(/(\d{1,2})[:h](\d{2})/);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;

  const day = DAYS.findIndex((name) => text.includes(name));
  if (day >= 0) return { kind: 'weekly', weekday: day, hour, minute };
  if (/\bday\b|\bdaily\b|\bjour\b/.test(text)) return { kind: 'daily', hour, minute };
  return null;
}

/**
 * The most recent moment this schedule was due at or before `now`, in the
 * guild's own timezone, or null when the phrase is not one we read.
 *
 * The comparison happens on the wall clock the guild lives by, because "every
 * Thursday at 18:00" means their Thursday and their six o'clock.
 */
export function lastDue(when: string | undefined, now: Date, timezone: string | null): Date | null {
  const schedule = readSchedule(when);
  if (!schedule) return null;

  const zone = timezone || 'UTC';
  for (let back = 0; back < 8; back++) {
    const day = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
    const parts = wallClock(day, zone);
    if (schedule.kind === 'weekly' && parts.weekday !== schedule.weekday) continue;
    const due = atWallClock(day, zone, schedule.hour, schedule.minute);
    if (due.getTime() <= now.getTime()) return due;
  }
  return null;
}

/** Whether it is due and has not already run for that moment. */
export function isDue(input: {
  when: string | undefined;
  now: Date;
  timezone: string | null;
  lastRun: string | null;
}): { due: true; at: Date } | { due: false } {
  const at = lastDue(input.when, input.now, input.timezone);
  if (!at) return { due: false };
  if (input.lastRun && new Date(input.lastRun).getTime() >= at.getTime()) return { due: false };
  return { due: true, at };
}

/** The date, as the guild's clock reads it. */
function wallClock(date: Date, zone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: DAYS.indexOf(get('weekday').toLowerCase()),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/**
 * That day, at that wall-clock time in that zone, as an instant.
 *
 * Found by correction rather than by arithmetic on offsets: guess UTC, see
 * what the zone makes of it, and shift by the difference. Twice, so an hour
 * that moves for daylight saving still lands.
 */
function atWallClock(day: Date, zone: string, hour: number, minute: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
  let guess = new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00Z`);
  for (let i = 0; i < 2; i++) {
    const seen = wallClock(guess, zone);
    const drift = (seen.hour - hour) * 60 + (seen.minute - minute);
    if (drift === 0) break;
    guess = new Date(guess.getTime() - drift * 60 * 1000);
  }
  return guess;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
