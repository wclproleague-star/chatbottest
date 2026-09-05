// Times are stored in UTC and shown in the guild's own timezone.
//
// Postgres timestamptz keeps the instant, not the wall clock, so nothing here
// converts on the way in. Everything a member or an owner reads goes through
// these, because "Sunday 18:00" means nothing without saying where.

/** A date and time as the guild reads it: "Sun 7 Sep, 18:00 CET". */
export function inZone(when: Date | string, timezone: string | null): string {
  const at = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: false,
    }).format(at);
  } catch {
    // An unknown timezone is the owner's mistake, not a reason to show nothing.
    return inZone(at, null);
  }
}

/** Just the clock, for a line that already says which day: "18:00 CET". */
export function clockIn(when: Date | string, timezone: string | null): string {
  const at = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: false,
    }).format(at);
  } catch {
    return clockIn(at, null);
  }
}

/** How long data is kept after the bot is removed from a server. */
export const RETENTION_DAYS = 30;

/** Whether a guild that removed the bot is now past its retention window. */
export function pastRetention(uninstalledAt: string | null | undefined, now = Date.now()): boolean {
  if (!uninstalledAt) return false;
  const at = new Date(uninstalledAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at > RETENTION_DAYS * 24 * 60 * 60 * 1000;
}
