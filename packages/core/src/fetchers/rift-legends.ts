// Rift Legends: matches and rosters, from the league's own JSON.
//
// The shape below is the contract. Point a source at the real base URL and it
// reads these fields; point it at `fixture:rift-legends` and it reads the file
// in evals/fixtures, which is what the evals and the match-day workflow run
// against, so neither needs the league to be up.
//
//   GET {base}/matches?from=<iso>&to=<iso>   -> { matches: Match[] }
//   GET {base}/teams/{teamId}/roster         -> { team: Team, players: Player[] }
//
//   Match  { id, stage, bestOf, scheduledAt (ISO 8601, UTC), status:
//            "scheduled" | "live" | "done", teams: [Team, Team], score?: [n, n] }
//   Team   { id, name, tag }
//   Player { id, handle, role, isCaptain, discordId? }
//
// discordId is the field that makes a roster worth having here: it is what
// lets Kalvard check who somebody is, and who to ask on match day. Everything
// else is readable by a member anyway.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIMEOUT_MS, SourceError, getJson } from './http';
import { registerFetcher } from '../sources';
import type { DataSource } from '../sources';

export type RiftTeam = { id: string; name: string; tag: string };
export type RiftPlayer = {
  id: string;
  handle: string;
  role?: string;
  isCaptain?: boolean;
  discordId?: string;
};
export type RiftMatch = {
  id: string;
  stage?: string;
  bestOf?: number;
  scheduledAt: string;
  status?: 'scheduled' | 'live' | 'done';
  score?: [number, number];
  teams: RiftTeam[];
};
export type RiftRoster = { team: RiftTeam; players: RiftPlayer[] };

/** How far ahead a question about "the next matches" looks. */
const WINDOW_DAYS = 14;

/** The fixture, read once: the evals and the workflow run off it. */
function fixture(): { matches: RiftMatch[]; rosters: Record<string, RiftRoster> } {
  const path = fileURLToPath(new URL('../../evals/fixtures/rift-legends.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as {
    matches: RiftMatch[];
    rosters: Record<string, RiftRoster>;
  };
}

type Config = { baseUrl: string; apiKey?: string; timeoutMs?: number };

function configOf(source: DataSource): Config {
  const raw = source.config as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (!baseUrl) throw new SourceError('This source has no address yet.');
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function headers(config: Config): Record<string, string> {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

/** Matches in the window, from the league or from the fixture. */
export async function riftMatches(source: DataSource, now = new Date()): Promise<RiftMatch[]> {
  const config = configOf(source);
  if (config.baseUrl.startsWith('fixture:')) return fixture().matches;
  const from = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const to = new Date(now.getTime() + WINDOW_DAYS * 86_400_000).toISOString();
  const body = (await getJson(
    `${config.baseUrl}/matches?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: headers(config), timeoutMs: config.timeoutMs },
  )) as { matches?: RiftMatch[] };
  if (!Array.isArray(body.matches)) throw new SourceError('It did not send back a match list.');
  return body.matches;
}

/** One team's roster, from the league or from the fixture. */
export async function riftRoster(source: DataSource, teamId: string): Promise<RiftRoster | null> {
  const config = configOf(source);
  if (config.baseUrl.startsWith('fixture:')) return fixture().rosters[teamId] ?? null;
  const body = (await getJson(`${config.baseUrl}/teams/${encodeURIComponent(teamId)}/roster`, {
    headers: headers(config),
    timeoutMs: config.timeoutMs,
  })) as RiftRoster | null;
  return body?.team ? body : null;
}

/** One match line, as a member would read it. */
export function describeMatch(match: RiftMatch): string {
  const [a, b] = match.teams;
  const who = `${a?.name ?? '?'} vs ${b?.name ?? '?'}`;
  const when = new Date(match.scheduledAt);
  const time = Number.isNaN(when.getTime()) ? match.scheduledAt : when.toISOString();
  const best = match.bestOf ? `, best of ${match.bestOf}` : '';
  const stage = match.stage ? `, ${match.stage}` : '';
  if (match.status === 'done' && match.score) {
    return `${who}: ${match.score[0]}-${match.score[1]}, played ${time}${stage}`;
  }
  return `${who} at ${time} (UTC)${best}${stage}`;
}

registerFetcher('rift_legends', async ({ source, question }) => {
  const asked = question.toLowerCase();
  const matches = await riftMatches(source);

  // A team named in the question narrows both halves of the answer.
  const teams = new Map<string, RiftTeam>();
  for (const match of matches) for (const team of match.teams) teams.set(team.id, team);
  const named = [...teams.values()].filter(
    (team) => asked.includes(team.name.toLowerCase()) || asked.includes(team.tag.toLowerCase()),
  );

  const wanted =
    named.length > 0
      ? matches.filter((m) => m.teams.some((t) => named.some((n) => n.id === t.id)))
      : matches;
  const upcoming = wanted
    .filter((m) => m.status !== 'done')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const played = wanted
    .filter((m) => m.status === 'done')
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  const lines: string[] = [];
  if (upcoming.length > 0) {
    lines.push('Coming up:', ...upcoming.slice(0, 5).map((m) => `- ${describeMatch(m)}`));
  }
  if (played.length > 0) {
    lines.push('Already played:', ...played.slice(0, 3).map((m) => `- ${describeMatch(m)}`));
  }

  // Only when they asked about a team, and only the handles: the roster carries
  // Discord ids, and nothing here puts one in front of a member.
  const rosterAsked =
    /roster|lineup|line-up|players|squad|composition|effectif|joueurs?/i.test(question) ||
    /who (plays|is) (for|on|in)|qui joue/i.test(question);
  if (rosterAsked && named.length > 0) {
    for (const team of named.slice(0, 2)) {
      const roster = await riftRoster(source, team.id);
      if (!roster) continue;
      const players = roster.players
        .map((p) => `${p.handle}${p.isCaptain ? ' (captain)' : ''}${p.role ? `, ${p.role}` : ''}`)
        .join('; ');
      lines.push(`${roster.team.name} roster: ${players}`);
    }
  }

  if (lines.length === 0) return 'The league has nothing scheduled that matches that.';
  return lines.join(String.fromCharCode(10));
});
