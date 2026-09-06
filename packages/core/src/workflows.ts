// Workflows: a routine a server runs, stored as data.
//
// A flow, not a list of actions. Steps read variables that earlier ones set,
// so a run can fan out over this week's matches, ask each captain, flip a
// coin, wait for a screenshot and come back to the same match with the answer.
//
// Two rules shape the whole engine. Nothing unmapped is ever guessed at: a
// step that cannot resolve what it needs stops the run and says what is
// missing. And every write goes through the same allowlist the answer loop
// uses, so a workflow can never do something an owner did not switch on.
//
// A run is a value, not a call. It carries its variables, what it has done,
// and a stack of frames saying where it is in the flow; it runs until it has
// to wait — for a message, a screenshot, a button, a poll, or a clock — and
// hands that state back. Whoever holds the state (the bot, the eval) feeds it
// the event when it comes, and the run picks up where it left. That is what
// lets a best-of-three take three hours without the worker keeping anything
// in memory, and what lets a restart in the middle lose nothing.
//
// A dry run is the same code with the writes described instead of made. That
// is what the eval runs, and what an owner sees before they let one loose.

import type { Json } from './database.types';
import { serviceClient } from './supabase';

/** The kinds of step. */
export type Step =
  /** One allowlisted Discord action. */
  | { type: 'do'; action: string; with: Record<string, string>; as?: string }
  /**
   * Wait for something from Discord. `from` lists who may satisfy it: user
   * ids, role ids, or templates that fill to either; an entry that fills to
   * nothing is skipped, so "{reporter}" may be unset until somebody reports.
   * `teams` names variables holding `{ roleId }`, and the event says which of
   * them the sender belongs to.
   */
  | {
      type: 'wait_for';
      event: 'message' | 'attachment' | 'reaction' | 'button';
      in?: string;
      from?: string | string[];
      teams?: string[];
      timeoutMinutes: number;
      onTimeout: Step[];
      as?: string;
    }
  /** Buttons put to particular people; the label they chose is the answer. */
  | {
      type: 'ask';
      question: string;
      options: string[];
      of: string;
      in?: string;
      as: string;
      timeoutMinutes?: number;
      onTimeout?: Step[];
    }
  /** A branch on a variable, or on `{a} == b` / `{a} != b`. */
  | { type: 'if'; when: string; then: Step[]; else?: Step[] }
  /** Loop while the condition holds, re-read on every pass. */
  | { type: 'while'; when: string; steps: Step[]; atMost?: number }
  /** A random choice, said out loud. */
  | { type: 'pick'; from: string[]; announce?: string; in?: string; as: string }
  | { type: 'for_each'; items: string; as: string; steps: Step[] }
  /** Set a variable: a value, or a number added to what is there. */
  | { type: 'set'; var: string; value?: string; add?: number }
  /** Read from a data source: a draft session, a match, a roster. */
  | { type: 'fetch'; source: string; op: string; with?: Record<string, string>; as: string }
  /**
   * Poll a source until `when` holds. Nudges fire at the listed minutes
   * (each once) while waiting; the timeout has steps of its own.
   */
  | {
      type: 'wait_until';
      source: string;
      op: string;
      with?: Record<string, string>;
      as: string;
      when: string;
      everyMinutes?: number;
      nudges?: { afterMinutes: number; steps: Step[] }[];
      timeoutMinutes: number;
      onTimeout: Step[];
    }
  /** Read a picture with the model: is it an end screen, who won. */
  | { type: 'read_image'; url: string; as: string }
  /** Stop here, on purpose. */
  | { type: 'stop'; because: string };

export type Workflow = {
  id?: string;
  name: string;
  trigger: { kind: 'schedule' | 'request' | 'event'; when?: string; on?: string };
  steps: Step[];
  checks?: { must: string; otherwise: string }[];
  autoRun?: boolean;
  /** Switched off rather than deleted. */
  enabled?: boolean;
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

/** What a paused run is waiting for. */
export type Wait = {
  kind: 'event' | 'poll';
  /** For an event: what, where, from whom. */
  event?: 'message' | 'attachment' | 'reaction' | 'button';
  channelId?: string;
  from: string[];
  teams?: string[];
  /** The step's own name for the answer. */
  as?: string;
  /** Options, for a button wait, so a label can be checked. */
  options?: string[];
  /** For a poll: when to look again. */
  pollAt?: string;
  /** When the wait runs out. */
  deadline: string;
  /** Nudges still to fire, as absolute times. */
  nudgesAt?: { at: string; index: number }[];
  /** What was asked, for the record. */
  what: string;
};

/** Where a run is: a stack of frames, innermost last. */
type Frame = {
  steps: Step[];
  index: number;
  /** A for_each in progress. */
  loop?: { items: unknown[]; at: number; as: string };
  /** A while in progress: re-check `when` when the body ends. */
  repeat?: { when: string; left: number };
  /** A wait_until in progress, at this frame's `index`. */
  polling?: { startedAt: string; fired: number[] };
};

/** The whole of a run, serialisable as it stands. */
export type RunState = {
  guildId: string;
  workflowId?: string;
  variables: Record<string, unknown>;
  entries: RunEntry[];
  frames: Frame[];
  /** Set while paused. */
  wait?: Wait;
  stoppedBecause?: string;
  done: boolean;
  /** Waits registered so far, for the summary; each with what its timeout does. */
  waiting: { what: string; from: string; minutes: number; onTimeout: string }[];
  /** In a rehearsal: the answers that were never waited for, by variable name. */
  skipped?: string[];
};

/** An event fed to a paused run. */
export type RunEvent =
  | {
      kind: 'message';
      from: string;
      /** The sender's role ids, so a team wait can be matched. */
      roles?: string[];
      text: string;
      attachments?: string[];
      messageId?: string;
    }
  | { kind: 'button'; from: string; roles?: string[]; chose: string }
  | { kind: 'reaction'; from: string; roles?: string[]; emoji: string }
  | { kind: 'poll' }
  | { kind: 'tick' };

/** What feeding an event did. */
export type Delivery =
  /** The event was for this run and it moved on (or finished). */
  | { taken: true; state: RunState }
  /** Not for this run: wrong channel, wrong person, wrong kind. `say` when the sender should be told. */
  | { taken: false; say?: string };

export type RunResult = {
  entries: RunEntry[];
  variables: Record<string, unknown>;
  /** Waits the run registered, with what happens when they run out. */
  waiting: { what: string; from: string; minutes: number; onTimeout: string }[];
  stoppedBecause?: string;
  /** The run as it stands, when it is paused on a wait. */
  state?: RunState;
};

/** What a workflow may do in Discord. The same allowlist the answer loop uses. */
export type WorkflowEffects = {
  postMessage(channelId: string, text: string, attachments?: string[]): Promise<void>;
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
  /** Read from a source, by kind of operation. */
  fetch?(source: string, op: string, args: Record<string, string>): Promise<unknown>;
  /** Read a picture. Scripted in evals, the model live. */
  readImage?(url: string): Promise<unknown>;
};

export type RunInput = {
  guildId: string;
  workflow: Workflow;
  /** Everything the trigger knows: the day, the matches, whatever it fetched. */
  context: Record<string, unknown>;
  effects: WorkflowEffects;
  allowedActions: string[];
  /** Describe the writes rather than make them. */
  dryRun?: boolean;
  now?: Date;
};

/** The actions a workflow step may name, beyond what the answer loop does. */
export const WORKFLOW_ACTIONS = [
  'post_message',
  'ask_buttons',
  'add_reaction',
  'pin_message',
] as const;

/** Runs from the start until done, stopped, or waiting. */
export async function runWorkflow(input: RunInput): Promise<RunResult> {
  const state: RunState = {
    guildId: input.guildId,
    workflowId: input.workflow.id,
    variables: { ...input.context },
    entries: [],
    frames: [{ steps: input.workflow.steps, index: 0 }],
    done: false,
    waiting: [],
  };
  await advance(state, input);
  return summary(state);
}

/** Feeds an event to a paused run and carries on. */
export async function resumeWorkflow(
  state: RunState,
  event: RunEvent,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<Delivery> {
  if (state.done || !state.wait) return { taken: false };
  const wait = state.wait;
  const now = input.now ?? new Date();

  if (event.kind === 'tick' || event.kind === 'poll') {
    // Nudges first, then the deadline, then (for a poll) a look.
    const due = (wait.nudgesAt ?? []).filter((n) => new Date(n.at) <= now);
    if (due.length > 0) {
      wait.nudgesAt = (wait.nudgesAt ?? []).filter((n) => new Date(n.at) > now);
      const frame = state.frames.at(-1)!;
      const step = frame.steps[frame.index]!;
      const nudges = step.type === 'wait_until' ? (step.nudges ?? []) : [];
      for (const n of due) {
        const nudge = nudges[n.index];
        if (!nudge) continue;
        // Nudge steps run in a frame of their own, then the wait resumes.
        const sub: RunState = {
          ...state,
          frames: [{ steps: nudge.steps, index: 0 }],
          wait: undefined,
        };
        await advance(sub, input);
        state.entries = sub.entries;
        state.variables = sub.variables;
        if (sub.stoppedBecause) {
          state.stoppedBecause = sub.stoppedBecause;
          state.done = true;
          state.wait = undefined;
          return { taken: true, state };
        }
      }
    }
    if (new Date(wait.deadline) <= now) {
      const frame = state.frames.at(-1)!;
      const step = frame.steps[frame.index]!;
      const onTimeout =
        step.type === 'wait_for' || step.type === 'wait_until'
          ? step.onTimeout
          : step.type === 'ask'
            ? (step.onTimeout ?? [])
            : [];
      state.entries.push({ step: 'timeout', detail: `${wait.what}: nobody answered in time` });
      state.wait = undefined;
      frame.index++;
      // The timeout's steps run before whatever follows the wait.
      if (onTimeout.length > 0) state.frames.push({ steps: onTimeout, index: 0 });
      await advance(state, input);
      return { taken: true, state };
    }
    if (wait.kind === 'poll' && (!wait.pollAt || new Date(wait.pollAt) <= now)) {
      const frame = state.frames.at(-1)!;
      const step = frame.steps[frame.index]!;
      if (step.type !== 'wait_until') return { taken: false };
      const looked = await look(step, state, input);
      if (looked === 'stopped') return { taken: true, state };
      if (looked) {
        state.wait = undefined;
        frame.index++;
        await advance(state, input);
      } else {
        wait.pollAt = new Date(now.getTime() + (step.everyMinutes ?? 1) * 60_000).toISOString();
      }
      return { taken: true, state };
    }
    return { taken: false };
  }

  if (wait.kind !== 'event') return { taken: false };
  const senderRoles = event.roles ?? [];
  const allowed =
    wait.from.length === 0 ||
    wait.from.includes(event.from) ||
    wait.from.some((id) => senderRoles.includes(id));

  if (event.kind === 'button') {
    if (wait.event !== 'button') return { taken: false };
    if (!allowed) return { taken: false, say: 'That question is not for you.' };
    if (wait.options && !wait.options.includes(event.chose)) return { taken: false };
    return settle(state, input, {
      chose: event.chose,
      from: event.from,
      team: teamOf(state, wait, senderRoles),
    });
  }
  if (event.kind === 'reaction') {
    if (wait.event !== 'reaction' || !allowed) return { taken: false };
    return settle(state, input, {
      emoji: event.emoji,
      from: event.from,
      team: teamOf(state, wait, senderRoles),
    });
  }
  if (event.kind === 'message') {
    if (wait.event === 'attachment') {
      if (!event.attachments || event.attachments.length === 0) return { taken: false };
      if (!allowed) {
        return {
          taken: false,
          say:
            wait.from.length === 1
              ? 'Only the reporter for this series sends screenshots.'
              : 'That screenshot is not for this step.',
        };
      }
      return settle(state, input, {
        attachment: event.attachments[0],
        attachments: event.attachments,
        from: event.from,
        text: event.text,
        messageId: event.messageId,
        team: teamOf(state, wait, senderRoles),
      });
    }
    if (wait.event === 'message') {
      if (!allowed) return { taken: false };
      const settled = await settle(state, input, {
        text: event.text,
        from: event.from,
        messageId: event.messageId,
        attachments: event.attachments ?? [],
        team: teamOf(state, wait, senderRoles),
      });
      // A screenshot that arrives while the run was only listening for a word
      // is still the screenshot. Live, the end screen came straight after the
      // draft card, settled the check-in, and the run then waited for a
      // picture that had already been posted.
      const next = settled.taken ? settled.state.wait : undefined;
      if (
        settled.taken &&
        next?.kind === 'event' &&
        next.event === 'attachment' &&
        (event.attachments ?? []).length > 0
      ) {
        const again = await resumeWorkflow(settled.state, event, input);
        return again.taken ? again : settled;
      }
      return settled;
    }
  }
  return { taken: false };
}

/** Which of the wait's teams the sender belongs to, by their roles. */
function teamOf(state: RunState, wait: Wait, roles: string[]): string | null {
  for (const name of wait.teams ?? []) {
    const team = read(state.variables, name) as { roleId?: unknown } | undefined;
    if (team && typeof team.roleId === 'string' && roles.includes(team.roleId)) return name;
  }
  return null;
}

/** The wait is satisfied: record the answer and carry on. */
async function settle(
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
  answer: Record<string, unknown>,
): Promise<Delivery> {
  const wait = state.wait!;
  const frame = state.frames.at(-1)!;
  if (wait.as) state.variables[wait.as] = answer;
  state.entries.push({
    step: 'answered',
    detail: `${wait.what}: ${describeAnswer(answer)}`,
  });
  state.wait = undefined;
  frame.index++;
  await advance(state, input);
  return { taken: true, state };
}

function describeAnswer(answer: Record<string, unknown>): string {
  if (typeof answer.chose === 'string') return `chose ${answer.chose}`;
  if (typeof answer.attachment === 'string') return `a screenshot from ${String(answer.from)}`;
  if (typeof answer.emoji === 'string') return `reacted ${answer.emoji}`;
  return `"${String(answer.text ?? '').slice(0, 80)}" from ${String(answer.from)}`;
}

/** Runs frames until the run is done, stopped, or waiting. */
async function advance(
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<void> {
  while (!state.done && !state.wait && !state.stoppedBecause) {
    const frame = state.frames.at(-1);
    if (!frame) {
      state.done = true;
      return;
    }
    if (frame.index >= frame.steps.length) {
      // A frame ran out: a loop goes round, a while re-checks, else pop.
      if (frame.loop && frame.loop.at + 1 < frame.loop.items.length) {
        frame.loop.at++;
        state.variables[frame.loop.as] = frame.loop.items[frame.loop.at];
        frame.index = 0;
        continue;
      }
      if (frame.loop) delete state.variables[frame.loop.as];
      if (frame.repeat && frame.repeat.left > 0 && holds(frame.repeat.when, state.variables)) {
        frame.repeat.left--;
        frame.index = 0;
        continue;
      }
      state.frames.pop();
      continue;
    }
    const step = frame.steps[frame.index]!;
    const moved = await runStep(step, frame, state, input);
    // A step that pushed a frame or set a wait leaves the index to the frame
    // it pushed; everything else moves on.
    if (moved === 'next') frame.index++;
  }
  if (state.stoppedBecause) state.done = true;
}

type Moved = 'next' | 'pushed' | 'waiting' | 'stopped';

async function runStep(
  step: Step,
  frame: Frame,
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<Moved> {
  const vars = state.variables;
  const now = input.now ?? new Date();
  switch (step.type) {
    case 'for_each': {
      const items = read(vars, step.items);
      if (!Array.isArray(items)) return stop(state, `there is no list called ${step.items}`);
      frame.index++;
      if (items.length === 0) return 'pushed';
      vars[step.as] = items[0];
      state.frames.push({ steps: step.steps, index: 0, loop: { items, at: 0, as: step.as } });
      return 'pushed';
    }

    case 'while': {
      frame.index++;
      if (!holds(step.when, vars)) return 'pushed';
      state.frames.push({
        steps: step.steps,
        index: 0,
        repeat: { when: step.when, left: (step.atMost ?? 20) - 1 },
      });
      return 'pushed';
    }

    case 'if': {
      frame.index++;
      const branch = holds(step.when, vars) ? step.then : (step.else ?? []);
      if (branch.length > 0) state.frames.push({ steps: branch, index: 0 });
      return 'pushed';
    }

    case 'set': {
      const name = fill(step.var, vars) ?? step.var;
      if (step.add !== undefined) {
        const current = Number(read(vars, name) ?? 0);
        write(vars, name, current + step.add);
      } else {
        // A bare `{path}` copies the value as it is, an object included, so
        // `set blue = {teamA}` carries the role id along with the name.
        const whole = (step.value ?? '').trim().match(/^\{([^{}]+)\}$/);
        const copied = whole ? read(vars, whole[1]!.trim()) : undefined;
        if (whole && copied !== undefined && copied !== null) {
          write(vars, name, copied);
          return 'next';
        }
        const value = fill(step.value ?? '', vars);
        if (value === null)
          return stop(state, `set ${name} needs ${step.value}, and nothing has it`);
        write(vars, name, value);
      }
      return 'next';
    }

    case 'stop': {
      const why = fill(step.because, vars) ?? step.because;
      return stop(state, why);
    }

    case 'do': {
      if (!input.allowedActions.includes(step.action)) {
        return stop(state, `${step.action} is not something this server lets Kalvard do`);
      }
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.with)) {
        const filled = fill(value, vars);
        if (filled === null)
          return stop(state, `${step.action} needs ${value}, and nothing has it`);
        args[key] = filled;
      }
      return carryOut(step.action, args, state, input);
    }

    case 'fetch': {
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.with ?? {})) {
        const filled = fill(value, vars);
        if (filled === null) return stop(state, `${step.op} needs ${value}, and nothing has it`);
        args[key] = filled;
      }
      if (!input.effects.fetch) return stop(state, `nothing here can read from ${step.source}`);
      try {
        const got = await input.effects.fetch(step.source, step.op, args);
        vars[step.as] = got;
        state.entries.push({ step: 'fetch', detail: `${step.source}.${step.op} → ${short(got)}` });
        return 'next';
      } catch (err) {
        return stop(
          state,
          `${step.source} did not answer: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'read_image': {
      const url = fill(step.url, vars);
      if (url === null) return stop(state, `read_image needs ${step.url}, and nothing has it`);
      if (!input.effects.readImage) return stop(state, 'nothing here can read a picture');
      const seen = await input.effects.readImage(url);
      vars[step.as] = seen;
      state.entries.push({ step: 'read_image', detail: short(seen) });
      return 'next';
    }

    case 'pick': {
      const from = step.from.map((option) => fill(option, vars) ?? option);
      // Announced with what it chose: nobody has to trust a coin they cannot see.
      const chosen = from[Math.floor(Math.random() * from.length)] ?? '';
      vars[step.as] = chosen;
      const line = step.announce
        ? (fill(step.announce, { ...vars, [step.as]: chosen }) ?? chosen)
        : `Picked ${chosen}`;
      if (step.in) {
        if (!input.allowedActions.includes('post_message')) {
          return stop(state, 'post_message is not something this server lets Kalvard do');
        }
        const channel = await where(step.in, state, input);
        if (channel === null) return 'stopped';
        if (!input.dryRun) await input.effects.postMessage(channel, line);
      }
      state.entries.push({ step: 'pick', detail: line, wouldHave: input.dryRun });
      return 'next';
    }

    case 'ask': {
      if (!input.allowedActions.includes('ask_buttons')) {
        return stop(state, 'ask_buttons is not something this server lets Kalvard do');
      }
      const who = fillList(step.of, vars);
      if (who.length === 0) return stop(state, `nobody to ask: ${step.of} resolved to nobody`);
      const question = fill(step.question, vars) ?? step.question;
      const channel = await where(step.in, state, input);
      if (channel === null) return 'stopped';
      const detail = `${question} → ${step.options.join(' / ')}, to ${who.join(', ')}`;
      if (input.dryRun) {
        state.entries.push({ step: 'ask', detail, wouldHave: true });
      } else {
        await input.effects.askButtons({
          channelId: channel,
          question,
          options: step.options,
          whoMayAnswer: who,
        });
        state.entries.push({ step: 'ask', detail });
      }
      const minutes = step.timeoutMinutes ?? 60;
      state.waiting.push({
        what: question,
        from: who.join(', '),
        minutes,
        onTimeout: (step.onTimeout ?? []).map(describe).join(', then ') || 'ask again',
      });
      // A rehearsal cannot wait for a click: the wait is described, and the run
      // goes on without the answer.
      if (input.dryRun) {
        (state.skipped ??= []).push(step.as);
        return 'next';
      }
      state.wait = {
        kind: 'event',
        event: 'button',
        channelId: channel,
        from: who,
        as: step.as,
        options: step.options,
        deadline: new Date(now.getTime() + minutes * 60_000).toISOString(),
        what: question,
      };
      return 'waiting';
    }

    case 'wait_for': {
      // A list of templates is a list of alternatives, first one that fills
      // wins: ["{reporter}", "{blue.roleId},{red.roleId}"] is the reporter once
      // there is one, and either team until then.
      const templates =
        step.from === undefined ? [] : Array.isArray(step.from) ? step.from : [step.from];
      const who = templates.map((t) => fillList(t, vars)).find((list) => list.length > 0) ?? [];
      const onTimeout = step.onTimeout.map(describe).join(', then ') || 'nothing';
      const channel = await where(step.in, state, input);
      if (channel === null) return 'stopped';
      state.waiting.push({
        what: step.event,
        from: who.length > 0 ? who.join(', ') : 'anyone',
        minutes: step.timeoutMinutes,
        onTimeout,
      });
      state.entries.push({
        step: 'wait_for',
        detail: `${step.event} from ${who.length > 0 ? who.join(', ') : 'anyone'}, ${step.timeoutMinutes} minutes, then ${onTimeout}`,
        wouldHave: input.dryRun,
      });
      if (input.dryRun) {
        if (step.as) (state.skipped ??= []).push(step.as);
        return 'next';
      }
      state.wait = {
        kind: 'event',
        event: step.event,
        channelId: channel,
        from: who,
        teams: step.teams,
        as: step.as,
        deadline: new Date(now.getTime() + step.timeoutMinutes * 60_000).toISOString(),
        what: `${step.event} from ${who.length > 0 ? who.join(', ') : 'anyone'}`,
      };
      return 'waiting';
    }

    case 'wait_until': {
      // One look straight away; then the poll is left to the clock.
      frame.polling = { startedAt: now.toISOString(), fired: [] };
      const looked = await look(step, state, input);
      if (looked === 'stopped') return 'stopped';
      if (looked) return 'next';
      const every = (step.everyMinutes ?? 1) * 60_000;
      state.waiting.push({
        what: `${step.source}.${step.op} until ${step.when}`,
        from: 'the source',
        minutes: step.timeoutMinutes,
        onTimeout: step.onTimeout.map(describe).join(', then ') || 'nothing',
      });
      if (input.dryRun) {
        state.entries.push({
          step: 'wait_until',
          detail: `${step.source} until ${step.when}, looking every ${step.everyMinutes ?? 1} minute(s), ${step.timeoutMinutes} minutes at most`,
          wouldHave: true,
        });
        return 'next';
      }
      state.wait = {
        kind: 'poll',
        from: [],
        as: step.as,
        pollAt: new Date(now.getTime() + every).toISOString(),
        deadline: new Date(now.getTime() + step.timeoutMinutes * 60_000).toISOString(),
        nudgesAt: (step.nudges ?? []).map((n, index) => ({
          at: new Date(now.getTime() + n.afterMinutes * 60_000).toISOString(),
          index,
        })),
        what: `${step.source} until ${step.when}`,
      };
      return 'waiting';
    }
  }
}

/** One look at a polled source. True when the condition now holds. */
async function look(
  step: Extract<Step, { type: 'wait_until' }>,
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<boolean | 'stopped'> {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.with ?? {})) {
    const filled = fill(value, state.variables);
    if (filled === null) {
      stop(state, `${step.op} needs ${value}, and nothing has it`);
      return 'stopped';
    }
    args[key] = filled;
  }
  if (!input.effects.fetch) {
    stop(state, `nothing here can read from ${step.source}`);
    return 'stopped';
  }
  try {
    const got = await input.effects.fetch(step.source, step.op, args);
    state.variables[step.as] = got;
  } catch (err) {
    stop(
      state,
      `${step.source} did not answer: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'stopped';
  }
  return holds(step.when, state.variables);
}

async function carryOut(
  action: string,
  args: Record<string, string>,
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<Moved> {
  const detail = `${action} ${Object.entries(args)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')}`;
  if (input.dryRun) {
    state.entries.push({ step: 'do', detail, wouldHave: true });
    return 'next';
  }
  switch (action) {
    case 'post_message': {
      const channel = await where(args.channel, state, input);
      if (channel === null) return 'stopped';
      const attachments = (args.attachments ?? '')
        .split(/\s*,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      await input.effects.postMessage(
        channel,
        args.text ?? '',
        attachments.length > 0 ? attachments : undefined,
      );
      break;
    }
    case 'add_reaction':
      await input.effects.addReaction(args.channel ?? '', args.message ?? '', args.emoji ?? '✅');
      break;
    case 'pin_message':
      await input.effects.pinMessage(args.channel ?? '', args.message ?? '');
      break;
    default:
      return stop(state, `${action} is not an action Kalvard knows`);
  }
  state.entries.push({ step: 'do', detail });
  return 'next';
}

/** A channel by name or id, or a stop when it is not there any more. */
async function where(
  name: string | undefined,
  state: RunState,
  input: Omit<RunInput, 'workflow' | 'context'>,
): Promise<string | null> {
  if (!name) return '';
  const filled = fill(name, state.variables) ?? name;
  const id = await input.effects.channelId(filled);
  if (id) return id;
  stop(state, `there is no channel called ${filled} any more`);
  return null;
}

function stop(state: RunState, why: string): 'stopped' {
  // In a rehearsal, needing an answer nobody was waited for is not a fault:
  // it is where the rehearsal ends and a live run would carry on.
  const skipped = (state.skipped ?? []).find((name) => why.includes(`{${name}`));
  const said = skipped
    ? `the rehearsal ends here: ${skipped} only exists once somebody has answered in a live run`
    : why;
  state.stoppedBecause = said;
  state.entries.push({ step: 'stop', detail: said, stopped: true });
  return 'stopped';
}

/** `{a} == b`, `{a} != b`, or the truthiness of a filled template. */
function holds(when: string, variables: Record<string, unknown>): boolean {
  const compare = when.match(/^\s*(.+?)\s*(==|!=)\s*(.+?)\s*$/);
  if (compare) {
    const left = (fill(compare[1]!, variables) ?? '').trim().toLowerCase();
    const right = (fill(compare[3]!, variables) ?? compare[3]!).trim().toLowerCase();
    return compare[2] === '==' ? left === right : left !== right;
  }
  const value = fill(when, variables);
  return Boolean(value && value !== 'false' && value !== 'no' && value !== '0' && value !== 'null');
}

/** `{match.teams.0.name}` against the variables, or null when nothing has it. */
function fill(template: string, variables: Record<string, unknown>): string | null {
  let missing = false;
  const filled = template.replace(/\{([^{}]+)\}/g, (_, path: string) => {
    const value = read(variables, path.trim());
    if (value === undefined || value === null) {
      missing = true;
      return '';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
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

function write(variables: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let at: Record<string, unknown> = variables;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    if (!next || typeof next !== 'object') at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys.at(-1)!] = value;
}

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 160);
}

function describe(step: Step): string {
  switch (step.type) {
    case 'do':
      return `${step.action}`;
    case 'ask':
      return `ask ${step.of}`;
    case 'wait_for':
      return `wait for a ${step.event}`;
    case 'wait_until':
      return `wait on ${step.source}`;
    case 'pick':
      return 'pick one';
    case 'if':
      return 'branch';
    case 'while':
      return 'loop';
    case 'for_each':
      return 'repeat';
    case 'set':
      return `set ${step.var}`;
    case 'fetch':
      return `read ${step.source}`;
    case 'read_image':
      return 'read the picture';
    case 'stop':
      return 'stop';
  }
}

function summary(state: RunState): RunResult {
  return {
    entries: state.entries,
    variables: state.variables,
    waiting: state.waiting,
    stoppedBecause: state.stoppedBecause,
    state: state.wait ? state : undefined,
  };
}

/** Records what a run did, so the dashboard can show it and an owner can audit it. */
export async function recordRun(input: {
  guildId: string;
  workflowId?: string;
  mode: 'live' | 'dry_run';
  result: RunResult;
  /** The channel a paused run is waiting in, so events can find it. */
  channelId?: string | null;
}): Promise<string | null> {
  const paused = Boolean(input.result.state);
  const status = input.result.stoppedBecause ? 'stopped' : paused ? 'running' : 'done';
  const { data, error } = await serviceClient()
    .from('workflow_runs')
    .insert({
      guild_id: input.guildId,
      workflow_id: input.workflowId ?? null,
      mode: input.mode,
      status,
      finished_at: paused ? null : new Date().toISOString(),
      summary: {
        entries: input.result.entries,
        waiting: input.result.waiting,
        stoppedBecause: input.result.stoppedBecause ?? null,
      } as unknown as Json,
      state: (input.result.state ?? null) as unknown as Json,
      channel_id: input.channelId ?? input.result.state?.wait?.channelId ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.error(`kalvard: could not record the run: ${error.message}`);
    return null;
  }
  return data?.id ?? null;
}

/** Writes a paused run back after an event moved it. */
export async function saveRun(runId: string, state: RunState): Promise<void> {
  const paused = Boolean(state.wait) && !state.done;
  const status = state.stoppedBecause ? 'stopped' : paused ? 'running' : 'done';
  const { error } = await serviceClient()
    .from('workflow_runs')
    .update({
      status,
      finished_at: paused ? null : new Date().toISOString(),
      summary: {
        entries: state.entries,
        waiting: state.waiting,
        stoppedBecause: state.stoppedBecause ?? null,
      } as unknown as Json,
      state: (paused ? state : null) as unknown as Json,
      channel_id: state.wait?.channelId ?? null,
    })
    .eq('id', runId);
  if (error) console.error(`kalvard: could not save the run: ${error.message}`);
}

/** Every run in this guild that is paused on a wait. */
export async function pausedRuns(
  guildId: string,
): Promise<{ id: string; state: RunState; channelId: string | null }[]> {
  const { data } = await serviceClient()
    .from('workflow_runs')
    .select('id, state, channel_id')
    .eq('guild_id', guildId)
    .eq('status', 'running')
    .not('state', 'is', null);
  return (data ?? [])
    .filter((row) => row.state)
    .map((row) => ({
      id: row.id,
      state: row.state as unknown as RunState,
      channelId: row.channel_id,
    }));
}

// The store ---------------------------------------------------------------
// A workflow is data, so reading and writing one is the boring part on
// purpose: no logic lives here that the engine or the author does not own.

/** Every workflow this guild has, newest first. */
export async function listWorkflows(guildId: string): Promise<Workflow[]> {
  const { data, error } = await serviceClient()
    .from('workflows')
    .select('id, name, trigger, steps, checks, enabled, auto_run')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`kalvard: could not read the workflows: ${error.message}`);
    return [];
  }
  return (data ?? []).map(fromRow);
}

export async function getWorkflow(guildId: string, id: string): Promise<Workflow | null> {
  const { data } = await serviceClient()
    .from('workflows')
    .select('id, name, trigger, steps, checks, enabled, auto_run')
    .eq('guild_id', guildId)
    .eq('id', id)
    .maybeSingle();
  return data ? fromRow(data) : null;
}

/**
 * Writes one. A workflow is keyed by its name inside a guild, so saving a
 * routine that already exists updates it rather than leaving two behind.
 */
export async function saveWorkflow(input: {
  guildId: string;
  workflow: Workflow;
  createdBy?: string;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const row = {
    guild_id: input.guildId,
    name: input.workflow.name,
    trigger: input.workflow.trigger as unknown as Json,
    steps: input.workflow.steps as unknown as Json,
    checks: (input.workflow.checks ?? []) as unknown as Json,
    auto_run: input.workflow.autoRun ?? false,
    created_by: input.createdBy ?? null,
  };
  const { data, error } = await serviceClient()
    .from('workflows')
    .upsert(row, { onConflict: 'guild_id,name' })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`kalvard: could not save the workflow: ${error?.message ?? 'no row came back'}`);
    return { ok: false, message: 'Could not save that workflow. Try again.' };
  }
  return { ok: true, id: data.id };
}

/** Switched off rather than deleted: a routine somebody wrote is kept. */
export async function setWorkflowEnabled(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await serviceClient()
    .from('workflows')
    .update({ enabled })
    .eq('guild_id', guildId)
    .eq('id', id);
  if (error) console.error(`kalvard: could not switch the workflow: ${error.message}`);
}

/** What the runs did, newest first, for the dashboard. */
export async function listRuns(
  guildId: string,
  limit = 20,
): Promise<
  {
    id: string;
    workflowId: string | null;
    mode: 'live' | 'dry_run';
    status: string;
    startedAt: string;
    entries: RunEntry[];
    stoppedBecause: string | null;
  }[]
> {
  const { data } = await serviceClient()
    .from('workflow_runs')
    .select('id, workflow_id, mode, status, started_at, summary')
    .eq('guild_id', guildId)
    .order('started_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => {
    const summary = (row.summary ?? {}) as {
      entries?: RunEntry[];
      stoppedBecause?: string | null;
    };
    return {
      id: row.id,
      workflowId: row.workflow_id,
      mode: row.mode as 'live' | 'dry_run',
      status: row.status,
      startedAt: row.started_at,
      entries: summary.entries ?? [],
      stoppedBecause: summary.stoppedBecause ?? null,
    };
  });
}

function fromRow(row: {
  id: string;
  name: string;
  trigger: unknown;
  steps: unknown;
  checks: unknown;
  enabled?: boolean;
  auto_run?: boolean;
}): Workflow {
  return {
    id: row.id,
    name: row.name,
    trigger: (row.trigger ?? { kind: 'request' }) as Workflow['trigger'],
    steps: (row.steps ?? []) as Step[],
    checks: (row.checks ?? []) as Workflow['checks'],
    autoRun: Boolean(row.auto_run),
    enabled: row.enabled !== false,
  };
}

/**
 * Effects that do nothing, for a rehearsal on the web.
 *
 * The web has no Discord connection, and a dry run does not need one: every
 * write is described rather than made, so what these return is never used.
 * The one read a rehearsal does need is the channel, and without a connection
 * it says so rather than pretending the channel is there.
 */
export function runDryEffects(): WorkflowEffects {
  return {
    async postMessage() {},
    async askButtons() {},
    async addReaction() {},
    async pinMessage() {},
    async channelId(name: string) {
      return name;
    },
  };
}
