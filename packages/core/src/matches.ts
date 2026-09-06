// From the calendar to a channel: which matches are due to be prepared, what
// the channel is called, and which Discord role a team is.
//
// Nothing here touches Discord or the site. It is the arithmetic the bot's
// clock runs every minute against the calendar source, kept pure so it can
// be checked against the fixture without a server: a match five hours out is
// due, six hours out is not, a match already played never is, and a team is
// the role that carries its name unless the calendar says which role it is.

import type { RiftMatch, RiftTeam } from './fetchers/rift-legends';

/** How long before a match its channel is made and the teams greeted. */
export const LEAD_HOURS = 5;

/** The category match channels are made in when the owner has not said. */
export const DEFAULT_MATCH_CATEGORY = 'Matches';

/** The matches whose channel should exist by now and which have not been played. */
export function dueToPrepare(matches: RiftMatch[], now: Date, leadHours = LEAD_HOURS): RiftMatch[] {
  const lead = leadHours * 3_600_000;
  return matches
    .filter((m) => m.status !== 'done')
    .filter((m) => {
      const at = new Date(m.scheduledAt).getTime();
      if (Number.isNaN(at)) return false;
      // Due once inside the lead window; a match long past its hour is not
      // prepared after the fact, the moderators would only find an empty room.
      return at - now.getTime() <= lead && now.getTime() - at < 3 * 3_600_000;
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** `#fast-forward-vs-baguette`, the way Discord will spell it anyway. */
export function channelNameFor(match: RiftMatch): string {
  const [a, b] = match.teams;
  const slug = (name: string): string =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(
        new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
        '',
      )
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  return `${slug(a?.name ?? 'team')}-vs-${slug(b?.name ?? 'team')}`.slice(0, 90);
}

/**
 * The role that is this team. The calendar's own say wins when it has one;
 * otherwise the role whose plain name is the team's name or tag. Nothing
 * close enough is null: a channel for the wrong role is worse than none, so
 * the caller stops and tells the moderators which team has no role.
 */
export function teamRole(
  team: RiftTeam & { discordRoleId?: string | null },
  roles: { id: string; name: string }[],
): { id: string; name: string } | null {
  if (team.discordRoleId) {
    const byId = roles.find((r) => r.id === team.discordRoleId);
    if (byId) return byId;
  }
  const wanted = new Set([plain(team.name), plain(team.tag)].filter(Boolean));
  const exact = roles.filter((r) => wanted.has(plain(r.name)));
  return exact.length === 1 ? exact[0]! : null;
}

function plain(name: string | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .replace(/[^a-z0-9]+/g, '');
}

/** The match's hour where the guild lives: "21:00 CEST". */
export function startTimeIn(scheduledAt: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: false,
    }).format(new Date(scheduledAt));
  } catch {
    return scheduledAt;
  }
}

/** One line per upcoming match for the dashboard, with where it has got to. */
export type UpcomingMatch = {
  id: string;
  line: string;
  scheduledAt: string;
  /** prepared: channel made and greeted; running: the series is on; done; or nothing yet. */
  state: 'upcoming' | 'prepared' | 'running' | 'done' | 'stopped';
};
