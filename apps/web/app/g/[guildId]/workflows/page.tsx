import {
  dueToPrepare,
  findRepeat,
  listRuns,
  listWorkflows,
  offer,
  parseSources,
  readBack,
  riftMatchesBetween,
  serviceClient,
  startTimeIn,
  TEMPLATES,
} from '@kalvard/core';
import type { DataSource, UpcomingMatch } from '@kalvard/core';
import { PageTitle } from '@/components/dashboard/page-title';
import { formatDate } from '@/lib/format';
import { requireMember } from '@/lib/guild';
import { Workflows } from './workflows-page';
import type { Listed, Run } from './workflows-page';

// The queries behind the workflows page. What it looks like is in
// ./workflows-page. Every flow is read back in plain language here too, so the
// list says what a routine does rather than only what it is called.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireMember(guildId);

  const db = serviceClient();
  const [flows, runs, { data: history }, { data: settings }] = await Promise.all([
    listWorkflows(guildId),
    listRuns(guildId),
    db
      .from('commands')
      .select('ran, created_at')
      .eq('guild_id', guildId)
      .not('ran', 'is', null)
      .order('created_at', { ascending: false })
      .limit(60),
    db
      .from('guild_settings')
      .select('timezone, data_sources')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ]);

  // What the calendar has coming, and where each match has got to here.
  const upcoming = await upcomingMatches(
    guildId,
    parseSources(settings?.data_sources ?? null),
    settings?.timezone ?? null,
  );

  // What this server already does by hand, twice or more, on separate days.
  const repeat = findRepeat(
    (history ?? []).map((row) => ({
      at: row.created_at,
      actions: ((row.ran ?? []) as { action?: string; ok?: boolean }[])
        .filter((step) => step.ok !== false && step.action)
        .map((step) => String(step.action)),
    })),
    settings?.timezone ?? null,
  );
  const byId = new Map(flows.map((w) => [w.id ?? '', w.name]));

  const workflows: Listed[] = flows.map((w) => ({
    id: w.id ?? '',
    name: w.name,
    trigger: triggerLine(w.trigger),
    steps: w.steps.length,
    enabled: w.enabled !== false,
    readBack: readBack(w),
    brief: w.brief ?? null,
    rules: w.rules ?? [],
  }));

  const listed: Run[] = runs.map((r) => ({
    id: r.id,
    name: (r.workflowId && byId.get(r.workflowId)) || 'A workflow that has since gone',
    mode: r.mode,
    status: r.status,
    when: formatDate(r.startedAt),
    lines: r.entries.map((e) => (e.wouldHave ? `Would have: ${e.detail}` : e.detail)),
    stoppedBecause: r.stoppedBecause,
  }));

  return (
    <div>
      <PageTitle
        title="Workflows"
        lede="Routines this server runs. Describe one in your own words; Kalvard reads it back before it keeps it."
      />
      <Workflows
        guildId={guildId}
        workflows={workflows}
        runs={listed}
        upcoming={upcoming}
        noticed={repeat ? offer(repeat) : null}
        templates={TEMPLATES.filter((t) => !flows.some((w) => w.name === t.name)).map((t) => ({
          name: t.name,
          what: triggerLine(t.trigger),
          steps: t.steps.length,
          brief: t.brief ?? null,
        }))}
      />
    </div>
  );
}

/** The next two weeks of the calendar, each match with its state on this server. */
async function upcomingMatches(
  guildId: string,
  sources: DataSource[],
  timezone: string | null,
): Promise<UpcomingMatch[]> {
  let calendar = sources.find((s) => s.kind === 'rift_legends');
  if (!calendar && process.env.CALENDAR_URL) {
    calendar = {
      id: 'calendar',
      name: 'the match calendar',
      answers: 'matches',
      kind: 'rift_legends',
      config: {},
    };
  }
  if (!calendar) return [];
  const now = new Date();
  let matches;
  try {
    matches = await riftMatchesBetween(
      calendar,
      new Date(now.getTime() - 6 * 3_600_000),
      new Date(now.getTime() + 14 * 86_400_000),
    );
  } catch {
    return [];
  }
  const db = serviceClient();
  const [{ data: prepared }, { data: runs }] = await Promise.all([
    db.from('processed_events').select('id').eq('guild_id', guildId).like('id', 'match:%:prepare'),
    db
      .from('workflow_runs')
      .select('status, state, summary')
      .eq('guild_id', guildId)
      .order('started_at', { ascending: false })
      .limit(50),
  ]);
  const preparedIds = new Set(
    (prepared ?? []).map((r) => r.id.slice('match:'.length, -':prepare'.length)),
  );
  const runByMatch = new Map<string, string>();
  for (const run of runs ?? []) {
    const state = run.state as { variables?: { matchId?: unknown } } | null;
    const summary = run.summary as { variables?: { matchId?: unknown } } | null;
    const id = String(state?.variables?.matchId ?? summary?.variables?.matchId ?? '');
    if (id && !runByMatch.has(id)) runByMatch.set(id, run.status);
  }
  const due = new Set(dueToPrepare(matches, now).map((m) => m.id));
  return matches
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((m) => {
      const run = runByMatch.get(m.id);
      const state: UpcomingMatch['state'] =
        m.status === 'done' || run === 'done'
          ? 'done'
          : run === 'stopped' || run === 'failed'
            ? 'stopped'
            : run === 'running'
              ? 'running'
              : preparedIds.has(m.id) || due.has(m.id)
                ? 'prepared'
                : 'upcoming';
      const [a, b] = m.teams;
      return {
        id: m.id,
        line: `${a?.name ?? '?'} vs ${b?.name ?? '?'}, ${formatDate(m.scheduledAt)} ${startTimeIn(m.scheduledAt, timezone)}`,
        scheduledAt: m.scheduledAt,
        state,
      };
    });
}

/** What starts it, in words rather than in a shape. */
function triggerLine(trigger: { kind: string; when?: string; on?: string }): string {
  if (trigger.kind === 'schedule') return trigger.when ? `Runs ${trigger.when}` : 'On a schedule';
  if (trigger.kind === 'event') return trigger.on ? `When ${trigger.on}` : 'On a Discord event';
  return 'When somebody asks';
}
