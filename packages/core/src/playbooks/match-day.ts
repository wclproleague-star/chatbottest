// Match day: the routine a league runs every week, written as a playbook.
//
// The shape is the point. Nothing here knows about Rift Legends: the trigger
// builds a context out of whatever the guild's source returned, and the steps
// read it by name. Point the source somewhere else and the same playbook runs.
//
// What it does on the day: announce each match, ask both captains whether they
// are ready, flip a coin for side and say what it landed on, then wait for the
// result screenshot, nudging at thirty minutes and bringing in the moderators
// at forty-five. Every wait names who may satisfy it, and every timeout has
// something to do.

import { describeMatch, riftMatches, riftRoster } from '../fetchers/rift-legends';
import type { RiftMatch } from '../fetchers/rift-legends';
import type { DataSource } from '../sources';
import type { Playbook } from '../playbooks';

/** One match, flattened into the names the steps use. */
export type MatchDayMatch = {
  id: string;
  home: string;
  away: string;
  time: string;
  bestOf: number;
  stage: string;
  line: string;
  /** Who may answer for each side: their Discord ids when the roster has them. */
  captains: string[];
  captainHandles: string[];
};

export type MatchDayContext = {
  day: string;
  matches: MatchDayMatch[];
};

/**
 * What the day looks like, from the source the owner configured. A day with no
 * matches returns an empty list, and the run does nothing rather than
 * inventing something to announce.
 */
export async function matchDayContext(
  source: DataSource,
  when: Date,
  timezone = 'UTC',
): Promise<MatchDayContext> {
  const all = await riftMatches(source, when);
  const day = dayIn(when, timezone);
  const today = all.filter(
    (m) => m.status !== 'done' && dayIn(new Date(m.scheduledAt), timezone) === day,
  );

  const matches: MatchDayMatch[] = [];
  for (const match of today) {
    const [home, away] = match.teams;
    const captains: string[] = [];
    const handles: string[] = [];
    for (const team of match.teams) {
      const roster = await riftRoster(source, team.id);
      for (const player of roster?.players ?? []) {
        if (!player.isCaptain) continue;
        handles.push(player.handle);
        if (player.discordId) captains.push(player.discordId);
      }
    }
    matches.push({
      id: match.id,
      home: home?.name ?? '?',
      away: away?.name ?? '?',
      time: clock(match, timezone),
      bestOf: match.bestOf ?? 1,
      stage: match.stage ?? '',
      line: describeMatch(match),
      captains,
      captainHandles: handles,
    });
  }
  return { day, matches };
}

/** The shipped template. An owner adopts it and edits it in their own words. */
export const MATCH_DAY: Playbook = {
  name: 'Match day',
  trigger: { kind: 'schedule', when: 'every match day, two hours before the first match' },
  autoRun: false,
  checks: [
    {
      must: 'the league source answered',
      otherwise: 'say nothing and tell the moderators, rather than announcing a day it invented',
    },
  ],
  steps: [
    {
      type: 'for_each',
      items: 'matches',
      as: 'match',
      steps: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'match-info',
            text: '{match.home} vs {match.away} today at {match.time}, best of {match.bestOf}. Captains, check in below.',
          },
        },
        {
          type: 'ask',
          question: 'Ready for {match.home} vs {match.away}?',
          options: ['Ready', 'Not yet'],
          of: 'match.captains',
          in: 'match-info',
          as: 'ready',
          timeoutMinutes: 15,
        },
        {
          type: 'pick',
          from: ['{match.home}', '{match.away}'],
          announce: 'Coin flip for {match.home} vs {match.away}: {side} picks side first.',
          as: 'side',
        },
        {
          type: 'wait_for',
          event: 'attachment',
          in: 'match-info',
          from: 'match.captains',
          timeoutMinutes: 30,
          onTimeout: [
            {
              type: 'do',
              action: 'post_message',
              with: {
                channel: 'match-info',
                text: 'Still waiting on the result screenshot for {match.home} vs {match.away}.',
              },
            },
            {
              type: 'wait_for',
              event: 'attachment',
              in: 'match-info',
              from: 'match.captains',
              timeoutMinutes: 15,
              onTimeout: [
                {
                  type: 'do',
                  action: 'post_message',
                  with: {
                    channel: 'match-info',
                    text: 'No screenshot for {match.home} vs {match.away} after 45 minutes. {mods}',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** The calendar day an instant falls on, where the guild lives. */
function dayIn(when: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(when);
  } catch {
    return when.toISOString().slice(0, 10);
  }
}

function clock(match: RiftMatch, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: false,
    }).format(new Date(match.scheduledAt));
  } catch {
    return match.scheduledAt;
  }
}
