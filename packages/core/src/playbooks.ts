// Playbooks: a routine a server runs, stored as data.
//
// A flow, not a list of actions. Five kinds of step, and steps read variables
// that earlier ones set, so a run can fan out over this week's matches, ask
// each captain, flip a coin and come back to the same match with the answer.
//
// Two rules shape the whole engine. Nothing unmapped is ever guessed at: a
// step that cannot resolve what it needs stops the run and says what is
// missing. And every write goes through the same allowlist the answer loop
// uses, so a playbook can never do something an owner did not switch on.
//
// A dry run is the same code with the writes described instead of made. That
// is what the eval runs, and what an owner sees before they let one loose.

import type { Json } from './database.types';
import { serviceClient } from './supabase';

/** The five kinds of step. */
export type Step =
  | { type: 'do'; action: string; with: Record<string, string>; as?: string }
  | {
      type: 'wait_for';
      event: 'message' | 'attachment' | 'reaction' | 'button';
      in?: string;
      from?: string;
      timeoutMinutes: number;
      onTimeout: Step[];
      as?: string;
    }
  | {
      type: 'ask';
      question: string;
      options: string[];
      of: string;
      in?: string;
      as: string;
      timeoutMinutes?: number;
    }
  | { type: 'if'; when: string; then: Step[]; else?: Step[] }
  | { type: 'pick'; from: string[]; announce?: string; as: string }
  | { type: 'for_each'; items: string; as: string; steps: Step[] };

export type Playbook = {
  id?: string;
  name: string;
  trigger: { kind: 'schedule' | 'request' | 'event'; when?: string; on?: string };
  steps: Step[];
  checks?: { must: string; otherwise: string }[];
  autoRun?: boolean;
};

/** What a run did, or would have done, one line each. */
export type RunEntry = {
  step: string;
  detail: string;
  /** Set when this was described rather than carried out. */
  wouldHave?: boolean;
  /** Set when the run stopped here because something was unmapped. */
  stopped?: boolean;
};

export type RunResult = {
  entries: RunEntry[];
  variables: Record<string, unknown>;
  /** Waits the run registered, with what happens when they run out. */
  waiting: { what: string; from: string; minutes: number; onTimeout: string }[];
  stoppedBecause?: string;
};

/** What a playbook may do in Discord. The same allowlist the answer loop uses. */
export type PlaybookEffects = {
  postMessage(channelId: string, text: string): Promise<void>;
  askButtons(input: {
    channelId: string;
    question: string;
    options: string[];
    whoMayAnswer: string[];
  }): Promise<void>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  pinMessage(channelId: string, messageId: string): Promise<void>;
  /** The channel an owner named, resolved to an id, or null when it is gone. */
  channelId(name: string): Promise<string | null>;
};

export type RunInput = {
  guildId: string;
  playbook: Playbook;
  /** Everything the trigger knows: the day, the matches, whatever it fetched. */
  context: Record<string, unknown>;
  effects: PlaybookEffects;
  allowedActions: string[];
  /** Describe the writes rather than make them. */
  dryRun?: boolean;
  now?: Date;
};

/** The actions a playbook step may name, beyond what the answer loop does. */
export const PLAYBOOK_ACTIONS = [
  'post_message',
  'ask_buttons',
  'add_reaction',
  'pin_message',
] as const;

export async function runPlaybook(input: RunInput): Promise<RunResult> {
  const result: RunResult = { entries: [], variables: { ...input.context }, waiting: [] };
  await runSteps(input.playbook.steps, input, result);
  return result;
}

async function runSteps(steps: Step[], input: RunInput, result: RunResult): Promise<void> {
  for (const step of steps) {
    if (result.stoppedBecause) return;
    await runStep(step, input, result);
  }
}

async function runStep(step: Step, input: RunInput, result: RunResult): Promise<void> {
  switch (step.type) {
    case 'for_each': {
      const items = read(result.variables, step.items);
      if (!Array.isArray(items)) return stop(result, `there is no list called ${step.items}`);
      for (const item of items) {
        result.variables[step.as] = item;
        await runSteps(step.steps, input, result);
        if (result.stoppedBecause) return;
      }
      delete result.variables[step.as];
      return;
    }

    case 'do': {
      if (!input.allowedActions.includes(step.action)) {
        return stop(result, `${step.action} is not something this server lets Kalvard do`);
      }
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.with)) {
        const filled = fill(value, result.variables);
        if (filled === null)
          return stop(result, `${step.action} needs ${value}, and nothing has it`);
        args[key] = filled;
      }
      await carryOut(step.action, args, input, result);
      return;
    }

    case 'ask': {
      const who = fillList(step.of, result.variables);
      if (who.length === 0) return stop(result, `nobody to ask: ${step.of} resolved to nobody`);
      const question = fill(step.question, result.variables) ?? step.question;
      const channel = await where(step.in, input, result);
      if (channel === null) return;
      const detail = `${question} → ${step.options.join(' / ')}, to ${who.join(', ')}`;
      if (input.dryRun) {
        result.entries.push({ step: 'ask', detail, wouldHave: true });
      } else {
        await input.effects.askButtons({
          channelId: channel,
          question,
          options: step.options,
          whoMayAnswer: who,
        });
        result.entries.push({ step: 'ask', detail });
      }
      if (step.timeoutMinutes) {
        result.waiting.push({
          what: question,
          from: who.join(', '),
          minutes: step.timeoutMinutes,
          onTimeout: 'ask again',
        });
      }
      return;
    }

    case 'wait_for': {
      const who = step.from ? fillList(step.from, result.variables) : ['anyone'];
      const onTimeout = step.onTimeout.map(describe).join(', then ') || 'nothing';
      result.waiting.push({
        what: step.event,
        from: who.join(', '),
        minutes: step.timeoutMinutes,
        onTimeout,
      });
      result.entries.push({
        step: 'wait_for',
        detail: `${step.event} from ${who.join(', ')}, ${step.timeoutMinutes} minutes, then ${onTimeout}`,
        wouldHave: input.dryRun,
      });
      return;
    }

    case 'pick': {
      const from = step.from.map((option) => fill(option, result.variables) ?? option);
      // Announced with what it chose: nobody has to trust a coin they cannot see.
      const chosen = from[Math.floor(Math.random() * from.length)] ?? '';
      result.variables[step.as] = chosen;
      const line = step.announce
        ? (fill(step.announce, { ...result.variables, [step.as]: chosen }) ?? chosen)
        : `Picked ${chosen}`;
      result.entries.push({ step: 'pick', detail: line, wouldHave: input.dryRun });
      return;
    }

    case 'if': {
      const value = fill(step.when, result.variables);
      const yes = Boolean(value && value !== 'false' && value !== 'no');
      await runSteps(yes ? step.then : (step.else ?? []), input, result);
      return;
    }
  }
}

async function carryOut(
  action: string,
  args: Record<string, string>,
  input: RunInput,
  result: RunResult,
): Promise<void> {
  const detail = `${action} ${Object.entries(args)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')}`;
  if (input.dryRun) {
    result.entries.push({ step: 'do', detail, wouldHave: true });
    return;
  }
  switch (action) {
    case 'post_message': {
      const channel = await where(args.channel, input, result);
      if (channel === null) return;
      await input.effects.postMessage(channel, args.text ?? '');
      break;
    }
    case 'add_reaction':
      await input.effects.addReaction(args.channel ?? '', args.message ?? '', args.emoji ?? '✅');
      break;
    case 'pin_message':
      await input.effects.pinMessage(args.channel ?? '', args.message ?? '');
      break;
    default:
      return stop(result, `${action} is not an action Kalvard knows`);
  }
  result.entries.push({ step: 'do', detail });
}

/** A channel by name, or a stop when it is not there any more. */
async function where(
  name: string | undefined,
  input: RunInput,
  result: RunResult,
): Promise<string | null> {
  if (!name) return '';
  const id = await input.effects.channelId(name);
  if (id) return id;
  stop(result, `there is no channel called ${name} any more`);
  return null;
}

function stop(result: RunResult, why: string): void {
  result.stoppedBecause = why;
  result.entries.push({ step: 'stop', detail: why, stopped: true });
}

/** `{match.teams.0.name}` against the variables, or null when nothing has it. */
function fill(template: string, variables: Record<string, unknown>): string | null {
  let missing = false;
  const filled = template.replace(/\{([^}]+)\}/g, (_, path: string) => {
    const value = read(variables, path.trim());
    if (value === undefined || value === null) {
      missing = true;
      return '';
    }
    return String(value);
  });
  return missing ? null : filled;
}

/** A list of people or things, from a path or a comma-separated template. */
function fillList(template: string, variables: Record<string, unknown>): string[] {
  const direct = read(variables, template.replace(/^\{|\}$/g, ''));
  if (Array.isArray(direct)) return direct.map(String).filter(Boolean);
  const filled = fill(template, variables);
  return (filled ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function read(variables: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return value[Number(key)];
    if (typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, variables);
}

function describe(step: Step): string {
  switch (step.type) {
    case 'do':
      return `${step.action}`;
    case 'ask':
      return `ask ${step.of}`;
    case 'wait_for':
      return `wait for a ${step.event}`;
    case 'pick':
      return 'pick one';
    case 'if':
      return 'branch';
    case 'for_each':
      return 'repeat';
  }
}

/** Records what a run did, so the dashboard can show it and an owner can audit it. */
export async function recordRun(input: {
  guildId: string;
  playbookId?: string;
  mode: 'live' | 'dry_run';
  result: RunResult;
}): Promise<void> {
  const status = input.result.stoppedBecause ? 'stopped' : 'done';
  const { error } = await serviceClient()
    .from('playbook_runs')
    .insert({
      guild_id: input.guildId,
      playbook_id: input.playbookId ?? null,
      mode: input.mode,
      status,
      finished_at: new Date().toISOString(),
      summary: {
        entries: input.result.entries,
        waiting: input.result.waiting,
        stoppedBecause: input.result.stoppedBecause ?? null,
      } as unknown as Json,
    });
  if (error) console.error(`kalvard: could not record the run: ${error.message}`);
}
