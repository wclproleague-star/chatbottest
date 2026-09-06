// The guild's draft site: open a session, read where it has got to.
//
// The shape below is the contract, and it is the one thing the site has to
// honour. Point a source at the real base URL and it calls these; point it at
// `fixture:draft-flow` and it plays a scripted session out of evals/fixtures,
// which is what the eval and a rehearsal run against.
//
//   POST {base}/drafts            { blueTeam, redTeam, label }
//     -> 201 { id, blueUrl, redUrl, spectatorUrl?, status: "waiting" }
//   GET  {base}/drafts/{id}
//     -> 200 { id, status: "waiting" | "drafting" | "done", startedAt?,
//              finishedAt?, blueTeam, redTeam,
//              picks: { blue: string[], red: string[] },
//              bans:  { blue: string[], red: string[] }, imageUrl: string | null }
//
// Every request carries `Authorization: Bearer <key>`. The key is never in the
// source's config: it is read from the environment (DRAFT_FLOW_KEY), so it
// never sits in a row an editor can read.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIMEOUT_MS, SourceError, getJson, postJson } from './http';
import { registerFetcher, registerOp } from '../sources';
import type { DataSource } from '../sources';

export type DraftStatus = 'waiting' | 'drafting' | 'done';

export type DraftSession = {
  id: string;
  status: DraftStatus;
  blueUrl: string;
  redUrl: string;
  spectatorUrl: string | null;
  blueTeam: string;
  redTeam: string;
  startedAt: string | null;
  finishedAt: string | null;
  picks: { blue: string[]; red: string[] };
  bans: { blue: string[]; red: string[] };
  imageUrl: string | null;
};

type Config = { baseUrl: string; timeoutMs: number };

function configOf(source: DataSource): Config {
  const raw = source.config as Record<string, unknown>;
  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : (process.env.DRAFT_FLOW_URL ?? '').trim();
  if (!baseUrl) throw new SourceError('The draft site has no address yet.');
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function headers(): Record<string, string> {
  const key = (process.env.DRAFT_FLOW_KEY ?? '').trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

// The fixture -------------------------------------------------------------
// A scripted site: every session created advances one state per look.

type Fixture = {
  links: { blue: string; red: string; spectator: string };
  done: { picks: DraftSession['picks']; bans: DraftSession['bans'] };
};

function fixture(): Fixture {
  const path = fileURLToPath(new URL('../../evals/fixtures/draft-flow.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const scripted = new Map<string, { session: DraftSession; looks: number }>();
let sessions = 0;

/** How many looks a scripted draft takes to finish. The eval leans on this. */
export const FIXTURE_LOOKS_TO_DONE = 3;

function scriptedCreate(input: { blueTeam: string; redTeam: string }): DraftSession {
  const f = fixture();
  const id = `draft-${++sessions}`;
  const session: DraftSession = {
    id,
    status: 'waiting',
    blueUrl: f.links.blue.replace('{id}', id),
    redUrl: f.links.red.replace('{id}', id),
    spectatorUrl: f.links.spectator.replace('{id}', id),
    blueTeam: input.blueTeam,
    redTeam: input.redTeam,
    startedAt: null,
    finishedAt: null,
    picks: { blue: [], red: [] },
    bans: { blue: [], red: [] },
    imageUrl: null,
  };
  scripted.set(id, { session, looks: 0 });
  return session;
}

function scriptedState(id: string): DraftSession {
  const entry = scripted.get(id);
  if (!entry) throw new SourceError('It answered 404.');
  entry.looks++;
  const f = fixture();
  if (entry.looks >= FIXTURE_LOOKS_TO_DONE) {
    entry.session = {
      ...entry.session,
      status: 'done',
      startedAt: entry.session.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      picks: f.done.picks,
      bans: f.done.bans,
    };
  } else if (entry.looks >= 2) {
    entry.session = {
      ...entry.session,
      status: 'drafting',
      startedAt: entry.session.startedAt ?? new Date().toISOString(),
    };
  }
  return entry.session;
}

/** Forgets the scripted sessions, so one eval does not inherit another's. */
export function resetDraftFixture(): void {
  scripted.clear();
  sessions = 0;
}

// The site ----------------------------------------------------------------

function normalise(raw: unknown, fallback: Partial<DraftSession> = {}): DraftSession {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = (['waiting', 'drafting', 'done'] as const).includes(r.status as DraftStatus)
    ? (r.status as DraftStatus)
    : 'waiting';
  const lists = (value: unknown): { blue: string[]; red: string[] } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
    return { blue: arr(v.blue), red: arr(v.red) };
  };
  const str = (x: unknown, or = ''): string => (typeof x === 'string' ? x : or);
  return {
    id: str(r.id, fallback.id ?? ''),
    status,
    blueUrl: str(r.blueUrl, fallback.blueUrl ?? ''),
    redUrl: str(r.redUrl, fallback.redUrl ?? ''),
    spectatorUrl: typeof r.spectatorUrl === 'string' ? r.spectatorUrl : null,
    blueTeam: str(r.blueTeam, fallback.blueTeam ?? ''),
    redTeam: str(r.redTeam, fallback.redTeam ?? ''),
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
    finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : null,
    picks: lists(r.picks),
    bans: lists(r.bans),
    imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : null,
  };
}

/** Opens a session and returns the two team links. */
export async function createDraft(
  source: DataSource,
  input: { blueTeam: string; redTeam: string; label: string },
): Promise<DraftSession> {
  const config = configOf(source);
  if (config.baseUrl.startsWith('fixture:')) return scriptedCreate(input);
  const body = await postJson(`${config.baseUrl}/drafts`, input, {
    headers: headers(),
    timeoutMs: config.timeoutMs,
  });
  const session = normalise(body, { blueTeam: input.blueTeam, redTeam: input.redTeam });
  if (!session.id || !session.blueUrl || !session.redUrl) {
    throw new SourceError('It opened a session but sent no links back.');
  }
  return session;
}

/** Where a session has got to. */
export async function draftState(source: DataSource, id: string): Promise<DraftSession> {
  const config = configOf(source);
  if (config.baseUrl.startsWith('fixture:')) return scriptedState(id);
  const body = await getJson(`${config.baseUrl}/drafts/${encodeURIComponent(id)}`, {
    headers: headers(),
    timeoutMs: config.timeoutMs,
  });
  return normalise(body, { id });
}

/** The finished draft as a card a channel can read, when the site has no picture. */
export function draftCard(session: DraftSession): string {
  const side = (name: string, team: string, picks: string[], bans: string[]): string =>
    `**${name} — ${team}**\nPicks: ${picks.join(', ') || '—'}\nBans: ${bans.join(', ') || '—'}`;
  return [
    'Draft done.',
    side('Blue', session.blueTeam, session.picks.blue, session.bans.blue),
    side('Red', session.redTeam, session.picks.red, session.bans.red),
  ].join('\n\n');
}

// What the workflow engine calls, by operation name.
registerOp('draft_flow', 'create', async (source, args) =>
  createDraft(source, {
    blueTeam: args.blueTeam ?? '',
    redTeam: args.redTeam ?? '',
    label: args.label ?? '',
  }),
);
registerOp('draft_flow', 'state', async (source, args) => draftState(source, args.id ?? ''));
registerOp('draft_flow', 'card', async (source, args) =>
  draftCard(await draftState(source, args.id ?? '')),
);

// What the answer loop gets when a member asks about a draft: only what a
// member could read on the site anyway.
registerFetcher('draft_flow', async ({ source, question }) => {
  const id = question.match(/draft-[a-z0-9-]+|[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
  if (!id) return 'Ask about a draft by its session id, and I can say where it has got to.';
  const session = await draftState(source, id);
  return `${session.blueTeam} (blue) vs ${session.redTeam} (red): ${session.status}.`;
});
