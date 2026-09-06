import {
  findRepeat,
  listRuns,
  listWorkflows,
  offer,
  readBack,
  serviceClient,
  TEMPLATES,
} from '@kalvard/core';
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
    db.from('guild_settings').select('timezone').eq('guild_id', guildId).maybeSingle(),
  ]);

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

/** What starts it, in words rather than in a shape. */
function triggerLine(trigger: { kind: string; when?: string; on?: string }): string {
  if (trigger.kind === 'schedule') return trigger.when ? `Runs ${trigger.when}` : 'On a schedule';
  if (trigger.kind === 'event') return trigger.on ? `When ${trigger.on}` : 'On a Discord event';
  return 'When somebody asks';
}
