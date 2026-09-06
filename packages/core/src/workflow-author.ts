// Writing a workflow by describing it.
//
// The owner says what happens on a match day in their own words. The model
// turns that into steps; everything that makes the flow safe to run is checked
// here rather than asked of the model, and whatever is missing comes back as
// one question at a time.
//
// What is never taken on trust: the actions a step names, whether this server
// has them switched on, that every wait says who may satisfy it and what
// happens when nobody does, that every question has buttons and somebody to
// put them to, and that every random choice is announced. Those are the four
// things somebody describing a routine never thinks to say, and every one of
// them is the difference between a flow that runs and a flow that hangs.
//
// The flow is read back in plain language before it is saved. The structured
// form exists and is shown to anyone who asks for it; it is never the thing an
// owner is expected to read.

import { generateJson, Type } from './gemini';
import type { Schema } from './gemini';
import { WORKFLOW_ACTIONS } from './workflows';
import type { Step, Workflow } from './workflows';

/** What the author came back with. */
export type Draft =
  /** Ready to read back and approve. */
  | { kind: 'workflow'; workflow: Workflow; readBack: string[] }
  /** One thing is missing, and this is the question that settles it. */
  | { kind: 'question'; question: string; because: string }
  /** Nothing here is something a workflow can do. */
  | { kind: 'refused'; because: string };

/** What the guild has, so a flow can be checked against it. */
export type WorkflowShape = {
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  /** The actions this guild has switched on. */
  allowedActions: string[];
};

export type RawStep = {
  type?: string;
  action?: string;
  with?: { key: string; value: string }[];
  as?: string;
  event?: string;
  in?: string;
  from?: string;
  timeoutMinutes?: number;
  onTimeout?: RawStep[];
  question?: string;
  options?: string[];
  of?: string;
  when?: string;
  then?: RawStep[];
  else?: RawStep[];
  items?: string;
  announce?: string;
  steps?: RawStep[];
};

/**
 * Compiles a description into a workflow, or asks the one question that stands
 * in the way. Editing an existing one is the same call with the flow it has:
 * the model changes what was asked for and leaves the rest alone.
 */
export async function authorWorkflow(input: {
  description: string;
  shape: WorkflowShape;
  /** The flow as it stands, when this is an edit rather than a first draft. */
  existing?: Workflow;
}): Promise<Draft> {
  const raw = await propose(input);
  if (raw.impossible.trim()) return { kind: 'refused', because: raw.impossible.trim() };
  if (!raw.name.trim()) {
    return {
      kind: 'question',
      question: 'What should this routine be called?',
      because: 'A workflow is triggered by name, so it needs one.',
    };
  }

  const steps: Step[] = [];
  for (const step of raw.steps) {
    const built = checkStep(step, input.shape);
    if ('question' in built) return built;
    if (built.step) steps.push(built.step);
  }
  if (steps.length === 0) {
    return {
      kind: 'refused',
      because: 'Nothing in that is something Kalvard can do on its own.',
    };
  }

  const workflow: Workflow = {
    id: input.existing?.id,
    name: raw.name.trim(),
    trigger: trigger(raw.trigger, input.existing),
    steps,
    checks: input.existing?.checks,
    autoRun: input.existing?.autoRun ?? false,
  };
  return { kind: 'workflow', workflow, readBack: readBack(workflow) };
}

/** What a raw step turns into: a step, nothing, or the question in the way. */
export type Checked =
  { step: Step | null } | { kind: 'question'; question: string; because: string };

/**
 * One step, checked. Returns a question instead whenever the thing that is
 * missing is one an owner has to decide. Exported so the checks can be
 * evaluated without a model behind them: they are the part that matters.
 */
export function checkStep(raw: RawStep, shape: WorkflowShape): Checked {
  const ask = (question: string, because: string) =>
    ({ kind: 'question', question, because }) as const;

  switch (raw.type) {
    case 'do': {
      const action = raw.action ?? '';
      if (!(WORKFLOW_ACTIONS as readonly string[]).includes(action)) {
        return ask(
          `Kalvard cannot do "${action || 'that'}" inside a workflow. What should happen instead?`,
          'A workflow only does what the answer loop is allowed to do.',
        );
      }
      if (!shape.allowedActions.includes(action)) {
        return ask(
          `${action.replace(/_/g, ' ')} is switched off for this server. Turn it on in Personality, or say what should happen instead.`,
          'A workflow never does more than the server allows.',
        );
      }
      const params: Record<string, string> = {};
      for (const { key, value } of raw.with ?? []) if (key) params[key] = value ?? '';
      return { step: { type: 'do', action, with: params, as: raw.as } };
    }

    case 'wait_for': {
      const event = raw.event ?? '';
      if (!['message', 'attachment', 'reaction', 'button'].includes(event)) {
        return ask(
          'What is Kalvard waiting for there: a message, an attachment, a reaction, or a button?',
          'A wait has to know what ends it.',
        );
      }
      // The two an owner never says, and the two that decide whether the flow
      // ever moves again.
      if (!raw.from?.trim()) {
        return ask(
          `Who may satisfy that wait? A role, a named member, or either captain.`,
          'Anyone could type in that channel, and the flow should not move on the wrong person.',
        );
      }
      if (!raw.timeoutMinutes || raw.timeoutMinutes <= 0) {
        return ask(
          'How long should it wait before doing something about it?',
          'A wait with no end is a routine that quietly stops.',
        );
      }
      const onTimeout: Step[] = [];
      for (const inner of raw.onTimeout ?? []) {
        const built = checkStep(inner, shape);
        if ('question' in built) return built;
        if (built.step) onTimeout.push(built.step);
      }
      if (onTimeout.length === 0) {
        return ask(
          'And what should happen when that time runs out?',
          'Every timeout needs something to do, or the flow ends without saying so.',
        );
      }
      return {
        step: {
          type: 'wait_for',
          event: event as 'message' | 'attachment' | 'reaction' | 'button',
          in: raw.in,
          from: raw.from.trim(),
          timeoutMinutes: raw.timeoutMinutes,
          onTimeout,
          as: raw.as,
        },
      };
    }

    case 'ask': {
      if (!raw.question?.trim()) {
        return ask('What exactly should Kalvard ask there?', 'A question needs its words.');
      }
      if (!raw.of?.trim()) {
        return ask(
          `Who should be asked "${raw.question.trim()}"?`,
          'A question put to nobody in particular is answered by whoever is quickest.',
        );
      }
      const options = (raw.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) {
        return ask(
          `What are the answers to "${raw.question.trim()}"? Two or more, as buttons.`,
          'A button is unambiguous and a typed answer is not.',
        );
      }
      return {
        step: {
          type: 'ask',
          question: raw.question.trim(),
          options,
          of: raw.of.trim(),
          in: raw.in,
          as: raw.as || slug(raw.question),
          timeoutMinutes: raw.timeoutMinutes,
        },
      };
    }

    case 'if': {
      if (!raw.when?.trim()) {
        return ask('What decides that branch?', 'A branch needs something to test.');
      }
      const then: Step[] = [];
      for (const inner of raw.then ?? []) {
        const built = checkStep(inner, shape);
        if ('question' in built) return built;
        if (built.step) then.push(built.step);
      }
      const otherwise: Step[] = [];
      for (const inner of raw.else ?? []) {
        const built = checkStep(inner, shape);
        if ('question' in built) return built;
        if (built.step) otherwise.push(built.step);
      }
      if (then.length === 0) return { step: null };
      return {
        step: { type: 'if', when: raw.when.trim(), then, else: otherwise.length ? otherwise : [] },
      };
    }

    case 'pick': {
      const from = (raw.items ? [] : (raw.options ?? [])).map((o) => o.trim()).filter(Boolean);
      if (from.length < 2) {
        return ask(
          'What is it choosing between?',
          'A random choice needs at least two things to choose from.',
        );
      }
      if (!raw.announce?.trim()) {
        return ask(
          'Should Kalvard say what it landed on, and where?',
          'Nobody should have to take a coin flip on trust.',
        );
      }
      return {
        step: { type: 'pick', from, announce: raw.announce.trim(), as: raw.as || 'choice' },
      };
    }

    case 'for_each': {
      if (!raw.items?.trim()) return { step: null };
      const inner: Step[] = [];
      for (const s of raw.steps ?? []) {
        const built = checkStep(s, shape);
        if ('question' in built) return built;
        if (built.step) inner.push(built.step);
      }
      if (inner.length === 0) return { step: null };
      return {
        step: { type: 'for_each', items: raw.items.trim(), as: raw.as || 'item', steps: inner },
      };
    }

    default:
      return { step: null };
  }
}

function trigger(raw: { kind?: string; when?: string; on?: string }, existing?: Workflow) {
  const kind = raw.kind === 'schedule' || raw.kind === 'event' ? raw.kind : 'request';
  if (kind === 'request' && existing) return existing.trigger;
  return { kind, when: raw.when || undefined, on: raw.on || undefined } as Workflow['trigger'];
}

/**
 * The flow in plain language, one line a step, so approving it is reading
 * rather than parsing. The structured form is never what somebody signs off.
 */
export function readBack(workflow: Workflow): string[] {
  const lines: string[] = [];
  const say = (step: Step, depth: number) => {
    const pad = '  '.repeat(depth);
    switch (step.type) {
      case 'do':
        lines.push(`${pad}${verb(step.action)}${detail(step.with)}`);
        break;
      case 'wait_for':
        lines.push(
          `${pad}Wait for a ${step.event} from ${step.from}${step.in ? ` in ${step.in}` : ''}, and after ${step.timeoutMinutes} minutes:`,
        );
        step.onTimeout.forEach((s) => say(s, depth + 1));
        break;
      case 'ask':
        lines.push(`${pad}Ask ${step.of}: "${step.question}" — ${step.options.join(' or ')}`);
        break;
      case 'if':
        lines.push(`${pad}If ${step.when}:`);
        step.then.forEach((s) => say(s, depth + 1));
        if (step.else?.length) {
          lines.push(`${pad}Otherwise:`);
          step.else.forEach((s) => say(s, depth + 1));
        }
        break;
      case 'pick':
        lines.push(
          `${pad}Pick one of ${step.from.join(', ')} and say so${step.announce ? ` in ${step.announce}` : ''}`,
        );
        break;
      case 'for_each':
        lines.push(`${pad}For each ${step.items}:`);
        step.steps.forEach((s) => say(s, depth + 1));
        break;
      case 'while':
        lines.push(`${pad}While ${step.when}:`);
        step.steps.forEach((s) => say(s, depth + 1));
        break;
      case 'set':
        lines.push(
          step.add !== undefined
            ? `${pad}Add ${step.add} to ${step.var}`
            : `${pad}Remember ${step.var} as ${step.value ?? ''}`,
        );
        break;
      case 'fetch':
        lines.push(`${pad}Read ${step.op} from ${step.source}${detail(step.with ?? {})}`);
        break;
      case 'wait_until':
        lines.push(
          `${pad}Keep reading ${step.source} until ${step.when}, every ${step.everyMinutes ?? 1} minute(s), and after ${step.timeoutMinutes} minutes:`,
        );
        step.onTimeout.forEach((s) => say(s, depth + 1));
        break;
      case 'read_image':
        lines.push(`${pad}Read the picture ${step.url}: is it an end screen, and who won`);
        break;
      case 'stop':
        lines.push(`${pad}Stop: ${step.because}`);
        break;
    }
  };
  workflow.steps.forEach((s) => say(s, 0));
  return lines;
}

/** What changed between two versions, so an edit reads back only its own part. */
export function whatChanged(before: Workflow, after: Workflow): string[] {
  const a = readBack(before);
  const b = readBack(after);
  const added = b.filter((line) => !a.includes(line));
  const gone = a.filter((line) => !b.includes(line));
  const out = [
    ...added.map((l) => `Added: ${l.trim()}`),
    ...gone.map((l) => `Removed: ${l.trim()}`),
  ];
  return out.length > 0 ? out : ['Nothing changed.'];
}

function verb(action: string): string {
  if (action === 'post_message') return 'Post';
  if (action === 'ask_buttons') return 'Ask with buttons';
  if (action === 'add_reaction') return 'React';
  if (action === 'pin_message') return 'Pin';
  return action.replace(/_/g, ' ');
}

function detail(params: Record<string, string>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'answer'
  );
}

async function propose(input: {
  description: string;
  shape: WorkflowShape;
  existing?: Workflow;
}): Promise<{
  name: string;
  trigger: { kind?: string; when?: string; on?: string };
  steps: RawStep[];
  impossible: string;
}> {
  const stepSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, enum: ['do', 'wait_for', 'ask', 'if', 'pick', 'for_each'] },
      action: { type: Type.STRING, enum: [...WORKFLOW_ACTIONS] },
      with: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { key: { type: Type.STRING }, value: { type: Type.STRING } },
          required: ['key', 'value'],
          propertyOrdering: ['key', 'value'],
        },
      },
      as: { type: Type.STRING },
      event: { type: Type.STRING, enum: ['message', 'attachment', 'reaction', 'button'] },
      in: { type: Type.STRING },
      from: { type: Type.STRING },
      timeoutMinutes: { type: Type.NUMBER },
      question: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      of: { type: Type.STRING },
      when: { type: Type.STRING },
      items: { type: Type.STRING },
      announce: { type: Type.STRING },
    },
    required: ['type'],
    propertyOrdering: [
      'type',
      'action',
      'with',
      'as',
      'event',
      'in',
      'from',
      'timeoutMinutes',
      'question',
      'options',
      'of',
      'when',
      'items',
      'announce',
    ],
  };

  const out = await generateJson<{
    name: string;
    trigger: { kind?: string; when?: string; on?: string };
    steps: RawStep[];
    impossible: string;
  }>({
    system: [
      'You turn a description of a routine into a flow for a Discord bot.',
      'Step kinds: do (one action), wait_for (an event, with who may satisfy it and a timeout), ask (a question with buttons, put to somebody), if (a branch), pick (a random choice), for_each (a loop).',
      `The only actions are: ${WORKFLOW_ACTIONS.join(', ')}.`,
      'Nesting past a timeout or a branch is expressed with onTimeout, then and else, which you may leave out; the caller asks for them.',
      'Never invent who may satisfy a wait, who is asked, or what a timeout does. Leave the field empty and the caller will ask the owner.',
      'Use the words the description uses for channels and roles. Do not rename them.',
      'impossible is one sentence, and only when nothing described is something a bot can do. Otherwise it is empty.',
      `This server has these channels: ${input.shape.channels.map((c) => c.name).join(', ') || 'none'}. Roles: ${input.shape.roles.map((r) => r.name).join(', ') || 'none'}.`,
      input.existing
        ? `This is an edit of an existing flow. Keep every step that the instruction does not touch. The flow now is: ${JSON.stringify(input.existing.steps)}`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    messages: [{ role: 'user', text: input.description }],
    schema: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        trigger: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, enum: ['schedule', 'request', 'event'] },
            when: { type: Type.STRING },
            on: { type: Type.STRING },
          },
          propertyOrdering: ['kind', 'when', 'on'],
        },
        steps: { type: Type.ARRAY, items: stepSchema },
        impossible: { type: Type.STRING },
      },
      required: ['name', 'steps', 'impossible'],
      propertyOrdering: ['name', 'trigger', 'steps', 'impossible'],
    },
    temperature: 0,
  });

  return {
    name: out.name ?? input.existing?.name ?? '',
    trigger: out.trigger ?? {},
    steps: out.steps ?? [],
    impossible: out.impossible ?? '',
  };
}
