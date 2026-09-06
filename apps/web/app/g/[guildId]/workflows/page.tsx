import { listRuns, listWorkflows, readBack } from '@kalvard/core';
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

  const [flows, runs] = await Promise.all([listWorkflows(guildId), listRuns(guildId)]);
  const byId = new Map(flows.map((w) => [w.id ?? '', w.name]));

  const workflows: Listed[] = flows.map((w) => ({
    id: w.id ?? '',
    name: w.name,
    trigger: triggerLine(w.trigger),
    steps: w.steps.length,
    enabled: w.enabled !== false,
    readBack: readBack(w),
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
      <Workflows guildId={guildId} workflows={workflows} runs={listed} />
    </div>
  );
}

/** What starts it, in words rather than in a shape. */
function triggerLine(trigger: { kind: string; when?: string; on?: string }): string {
  if (trigger.kind === 'schedule') return trigger.when ? `Runs ${trigger.when}` : 'On a schedule';
  if (trigger.kind === 'event') return trigger.on ? `When ${trigger.on}` : 'On a Discord event';
  return 'When somebody asks';
}
