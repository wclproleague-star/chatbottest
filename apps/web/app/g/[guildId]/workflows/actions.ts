'use server';

// Writing and keeping a workflow.
//
// Describing one is a conversation: what comes back is either the flow read
// out in plain language, or the one question standing in the way. Nothing is
// stored until somebody has read it back and said yes, and nothing is ever
// deleted — a routine somebody wrote is switched off, not thrown away.
//
// A dry run is how you find out what it would do without it doing anything:
// the same engine, the same steps, every write described instead of made.

import {
  authorWorkflow,
  getWorkflow,
  recordRun,
  runWorkflow,
  saveWorkflow,
  serviceClient,
  setWorkflowEnabled,
  runDryEffects,
  TEMPLATES,
} from '@kalvard/core';
import type { Draft, Workflow } from '@kalvard/core';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/guild';

export type DraftState =
  | { kind: 'workflow'; workflow: Workflow; readBack: string[]; id: number }
  | { kind: 'question'; question: string; because: string; id: number }
  | { kind: 'refused'; because: string; id: number }
  | { kind: 'saved'; note: string; id: number }
  | { kind: 'error'; error: string; id: number }
  | null;

export async function describeWorkflow(_prev: DraftState, form: FormData): Promise<DraftState> {
  const guildId = String(form.get('guild_id') ?? '');
  const description = String(form.get('description') ?? '').trim();
  const editing = String(form.get('workflow_id') ?? '');
  await requireMember(guildId);
  if (!description) return { kind: 'error', error: 'Describe the routine first.', id: Date.now() };

  const shape = await shapeOf(guildId);
  const existing = editing ? ((await getWorkflow(guildId, editing)) ?? undefined) : undefined;

  let draft: Draft;
  try {
    draft = await authorWorkflow({ description, shape, existing });
  } catch {
    return { kind: 'error', error: 'Could not work that out just now. Try again.', id: Date.now() };
  }
  if (draft.kind === 'refused') return { kind: 'refused', because: draft.because, id: Date.now() };
  if (draft.kind === 'question') {
    return { kind: 'question', question: draft.question, because: draft.because, id: Date.now() };
  }
  return {
    kind: 'workflow',
    workflow: draft.workflow,
    readBack: draft.readBack,
    id: Date.now(),
  };
}

/** Approved: written down as it was read back, and not a step more. */
export async function keepWorkflow(_prev: DraftState, form: FormData): Promise<DraftState> {
  const guildId = String(form.get('guild_id') ?? '');
  const { user } = await requireMember(guildId);
  let workflow: Workflow;
  try {
    workflow = JSON.parse(String(form.get('workflow') ?? '')) as Workflow;
  } catch {
    return { kind: 'error', error: 'That draft is gone. Describe it again.', id: Date.now() };
  }
  const outcome = await saveWorkflow({ guildId, workflow, createdBy: user.id });
  if (!outcome.ok) return { kind: 'error', error: outcome.message, id: Date.now() };
  revalidatePath(`/g/${guildId}/workflows`);
  return { kind: 'saved', note: `Kept. "${workflow.name}" is ready to run.`, id: Date.now() };
}

export async function toggleWorkflow(guildId: string, id: string, enabled: boolean) {
  await requireMember(guildId);
  await setWorkflowEnabled(guildId, id, enabled);
  revalidatePath(`/g/${guildId}/workflows`);
}

/** A rehearsal: reads happen, writes come back as lines. */
export async function rehearse(_prev: DraftState, form: FormData): Promise<DraftState> {
  const guildId = String(form.get('guild_id') ?? '');
  const id = String(form.get('workflow_id') ?? '');
  await requireMember(guildId);
  const workflow = await getWorkflow(guildId, id);
  if (!workflow) return { kind: 'error', error: 'That workflow is gone.', id: Date.now() };

  const { data: settings } = await serviceClient()
    .from('guild_settings')
    .select('allowed_actions')
    .eq('guild_id', guildId)
    .maybeSingle();

  const result = await runWorkflow({
    guildId,
    workflow,
    context: {},
    effects: runDryEffects(),
    allowedActions: settings?.allowed_actions ?? [],
    dryRun: true,
  });
  await recordRun({ guildId, workflowId: id, mode: 'dry_run', result });
  revalidatePath(`/g/${guildId}/workflows`);
  return {
    kind: 'saved',
    note: result.stoppedBecause
      ? `It would stop: ${result.stoppedBecause}`
      : `It would take ${result.entries.length} step${result.entries.length === 1 ? '' : 's'}. Nothing was done.`,
    id: Date.now(),
  };
}

/** Takes one of the shipped routines as it stands, to be edited from here. */
export async function adoptTemplate(_prev: DraftState, form: FormData): Promise<DraftState> {
  const guildId = String(form.get('guild_id') ?? '');
  const name = String(form.get('template') ?? '');
  const { user } = await requireMember(guildId);
  const template = TEMPLATES.find((t) => t.name === name);
  if (!template) return { kind: 'error', error: 'That template is gone.', id: Date.now() };

  const outcome = await saveWorkflow({ guildId, workflow: template, createdBy: user.id });
  if (!outcome.ok) return { kind: 'error', error: outcome.message, id: Date.now() };
  revalidatePath(`/g/${guildId}/workflows`);
  return {
    kind: 'saved',
    note: `Adopted. "${template.name}" is switched on and yours to edit.`,
    id: Date.now(),
  };
}

async function shapeOf(guildId: string) {
  const db = serviceClient();
  const [{ data: meta }, { data: settings }] = await Promise.all([
    db.from('guild_discord_meta').select('channels, roles').eq('guild_id', guildId).maybeSingle(),
    db.from('guild_settings').select('allowed_actions').eq('guild_id', guildId).maybeSingle(),
  ]);
  return {
    channels: (meta?.channels ?? []) as { id: string; name: string }[],
    roles: (meta?.roles ?? []) as { id: string; name: string }[],
    allowedActions: settings?.allowed_actions ?? [],
  };
}
