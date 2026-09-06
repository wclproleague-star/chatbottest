// The clock that starts a workflow.
//
// Every minute it asks, for each guild the bot is in, whether any enabled
// workflow with a schedule was due at a moment it has not already run for. The
// question is asked backwards — what was the most recent due moment — so a
// worker that was restarting at six o'clock still finds six o'clock when it
// comes back a minute later.
//
// Running twice is the thing to be afraid of, not running late, so the due
// moment itself is claimed by id before anything happens. Two workers, or one
// worker restarted mid-run, produce exactly one run.
//
// A run is live: it posts, it asks, it reacts. Everything it does is written to
// workflow_runs, and a step that cannot resolve what it needs stops the run and
// says so rather than guessing.

import type { Client } from 'discord.js';
import {
  getWorkflow,
  isDue,
  listWorkflows,
  recordRun,
  runWorkflow,
  serviceClient,
} from '@kalvard/core';
import { logEvent } from './guild';
import { claim } from './once';
import { workflowEffects } from './workflow';

/** How often the clock is read. A minute is finer than any schedule we take. */
const TICK_MS = 60_000;

export function startScheduler(client: Client): () => void {
  const timer = setInterval(() => {
    void tick(client).catch((err) => {
      console.error(`kalvard: scheduler failed: ${String(err)}`);
    });
  }, TICK_MS);
  // A restart should not wait a minute to notice a run it missed.
  void tick(client).catch(() => {});
  return () => clearInterval(timer);
}

async function tick(client: Client): Promise<void> {
  const now = new Date();
  for (const guild of client.guilds.cache.values()) {
    const workflows = await listWorkflows(guild.id);
    const scheduled = workflows.filter((w) => w.enabled !== false && w.trigger.kind === 'schedule');
    if (scheduled.length === 0) continue;

    const db = serviceClient();
    const { data: settings } = await db
      .from('guild_settings')
      .select('timezone, allowed_actions')
      .eq('guild_id', guild.id)
      .maybeSingle();

    for (const workflow of scheduled) {
      const { data: row } = await db
        .from('workflows')
        .select('last_run')
        .eq('id', workflow.id ?? '')
        .maybeSingle();

      const due = isDue({
        when: workflow.trigger.when,
        now,
        timezone: settings?.timezone ?? null,
        lastRun: row?.last_run ?? null,
      });
      if (!due.due) continue;

      // The due moment is what is claimed, not the workflow: the same routine
      // runs again next week, and only once this week.
      const id = `${workflow.id}:${due.at.toISOString()}`;
      if (!(await claim(id, 'workflow_due', guild.id))) continue;

      await run(guild.id, workflow.id ?? '', settings?.allowed_actions ?? [], client, due.at);
    }
  }
}

async function run(
  guildId: string,
  workflowId: string,
  allowedActions: string[],
  client: Client,
  dueAt: Date,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  const workflow = await getWorkflow(guildId, workflowId);
  if (!guild || !workflow) return;

  console.log(`kalvard: running "${workflow.name}" for ${guild.name}, due ${dueAt.toISOString()}`);
  const result = await runWorkflow({
    guildId,
    workflow,
    context: { dueAt: dueAt.toISOString() },
    effects: workflowEffects(guild),
    allowedActions,
    now: dueAt,
  });

  await recordRun({ guildId, workflowId, mode: 'live', result });
  // last_run is the due moment rather than the wall clock, so a late worker
  // does not leave a gap the next tick would fill again.
  await serviceClient()
    .from('workflows')
    .update({ last_run: dueAt.toISOString() })
    .eq('id', workflowId);

  await logEvent(guildId, 'action', {
    workflow: workflow.name,
    steps: result.entries.length,
    stoppedBecause: result.stoppedBecause ?? null,
  });
}
