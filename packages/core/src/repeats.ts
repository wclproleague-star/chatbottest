// Noticing that somebody keeps doing the same thing.
//
// A workflow is worth writing when a routine already exists in somebody's
// habits. The habits are on record: every command an owner confirmed is in
// `commands`, with what actually ran. So the detector reads that back and looks
// for the same sequence of actions on two different days.
//
// Three rules keep it from being noise. A sequence has to be at least two
// actions, because one action is not a routine. It has to have happened on
// separate days, because doing something twice in ten minutes is fixing a
// mistake, not keeping a routine. And it is only ever an offer: nothing is
// created, nothing is scheduled, and the owner is the one who decides whether
// what they do every Thursday is a thing they want a bot doing.

/** One command, as the detector needs it. */
export type CommandRecord = {
  /** When it ran, as an ISO timestamp. */
  at: string;
  /** The actions it actually carried out, in order. */
  actions: string[];
};

export type Repeat = {
  /** The actions, in the order they keep happening. */
  actions: string[];
  /** How many separate days it has happened on. */
  onDays: number;
  /** The day of the week it lands on, when it always lands on the same one. */
  weekday?: string;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The longest sequence this guild keeps repeating, or nothing.
 *
 * Longest rather than most frequent: "create a channel, then let two roles in"
 * is a routine, and the "create a channel" inside it is not a second one.
 */
export function findRepeat(commands: CommandRecord[], timezone: string | null): Repeat | null {
  const byDay = new Map<string, { actions: string[]; weekday: number }>();
  for (const command of commands) {
    if (command.actions.length === 0) continue;
    const when = new Date(command.at);
    if (Number.isNaN(when.getTime())) continue;
    const day = dayKey(when, timezone);
    const seen = byDay.get(day.key);
    if (seen) seen.actions.push(...command.actions);
    else byDay.set(day.key, { actions: [...command.actions], weekday: day.weekday });
  }

  const days = [...byDay.values()];
  if (days.length < 2) return null;

  let best: Repeat | null = null;
  for (const day of days) {
    // Every run of two or more actions this day contains, longest first.
    for (let length = day.actions.length; length >= 2; length--) {
      for (let start = 0; start + length <= day.actions.length; start++) {
        const run = day.actions.slice(start, start + length);
        const matching = days.filter((other) => contains(other.actions, run));
        if (matching.length < 2) continue;
        if (best && best.actions.length >= run.length) continue;

        const weekdays = new Set(matching.map((d) => d.weekday));
        best = {
          actions: run,
          onDays: matching.length,
          weekday: weekdays.size === 1 ? DAYS[[...weekdays][0]!] : undefined,
        };
      }
    }
  }
  return best;
}

/** The offer, in the owner's terms rather than the schema's. */
export function offer(repeat: Repeat): string {
  const what = repeat.actions.map(readable).join(', then ');
  const when = repeat.weekday ? ` and always on a ${repeat.weekday}` : '';
  return `You have done this on ${repeat.onDays} separate days${when}: ${what}. Want that as a workflow?`;
}

function readable(action: string): string {
  const words: Record<string, string> = {
    create_channel: 'create a channel',
    allow_roles: 'let roles into it',
    set_private: 'make it private',
    archive_channel: 'archive a channel',
    post_message: 'post a message',
    pin_message: 'pin it',
    assign_role: 'give somebody a role',
  };
  return words[action] ?? action.replace(/_/g, ' ');
}

function contains(haystack: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((value, j) => haystack[i + j] === value)) return true;
  }
  return false;
}

function dayKey(when: Date, timezone: string | null): { key: string; weekday: number } {
  const zone = timezone || 'UTC';
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(when);
  return { key, weekday: DAYS.findIndex((d) => d === name) };
}
