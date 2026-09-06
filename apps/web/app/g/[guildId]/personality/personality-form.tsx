'use client';

// How the bot talks, and how careful it is.
//
// The form carries the version it was opened with, so two people editing at
// once find out rather than overwriting each other. Below it, the same dry-run
// test chat as the Test page: a change of voice is something you hear, not
// something you imagine.

import { Button, Field, Input, Panel, Textarea, cx } from '@sentrybot/ui';
import { useActionState, useState } from 'react';
import { TestChat } from '../test/test-chat';
import { regenerateTones, savePersonality } from './actions';
import type { SaveState } from './actions';

type Named = { id: string; name: string };

const ACTIONS: [string, string][] = [
  ['point_to_channel', 'Point people at a channel'],
  ['assign_role', 'Give out a self-serve role'],
  ['escalate', 'Bring in a moderator'],
];

export function PersonalityForm({
  guildId,
  basedOn,
  values,
  roles,
}: {
  guildId: string;
  basedOn: string | null;
  values: {
    botName: string;
    persona: string;
    language: string;
    toneSample: string;
    forbidden: string[];
    maxReplyChars: number;
    threshold: number;
    allowedActions: string[];
    selfServeRoleIds: string[];
  };
  roles: Named[];
}) {
  const [state, act, pending] = useActionState<SaveState, FormData>(savePersonality, null);
  const [persona, setPersona] = useState(values.persona);
  const [tone, setTone] = useState(values.toneSample);
  const [threshold, setThreshold] = useState(values.threshold);
  const [samples, setSamples] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);

  async function newSamples() {
    setThinking(true);
    const outcome = await regenerateTones(guildId, persona);
    setThinking(false);
    setSamples('samples' in outcome ? outcome.samples : []);
  }

  return (
    <div className="mt-10 max-w-[880px]">
      <form action={act} className="max-w-[60ch] space-y-6">
        <input type="hidden" name="guild_id" value={guildId} />
        <input type="hidden" name="based_on" value={basedOn ?? ''} />

        <Field label="What is it called?">
          <Input name="bot_name" defaultValue={values.botName} maxLength={60} />
        </Field>

        <Field
          label="What is this server for, and how should it talk?"
          help="Tone only. It always answers from what your server knows, whatever you write here."
        >
          <Textarea
            name="persona_prompt"
            rows={4}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
        </Field>

        <Field label="One line in its voice">
          <Input name="tone_sample" value={tone} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <div>
          <button
            type="button"
            onClick={() => void newSamples()}
            disabled={thinking}
            className="text-ui-sm text-ink-soft hover:text-ink underline underline-offset-[3px] disabled:opacity-40"
          >
            {thinking ? 'Writing three' : 'Write me three'}
          </button>
          {samples && samples.length === 0 && (
            <p className="text-ui-sm text-ink-soft mt-2">Could not think of any just now.</p>
          )}
          {samples && samples.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {samples.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setTone(s)}
                    className={cx(
                      'text-ui-sm h-9 rounded-full border px-4',
                      s === tone ? 'border-ink bg-ink text-paper' : 'border-hairline text-ink',
                    )}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="What language should it reply in?" help="Leave empty to follow each member.">
          <Input name="language" defaultValue={values.language} />
        </Field>

        <Field label="What should it leave to people?" help="One per line.">
          <Textarea name="forbidden_topics" rows={4} defaultValue={values.forbidden.join('\n')} />
        </Field>

        <Field label="How long may a reply be?" help="In characters. 900 is about six lines.">
          <Input
            name="max_reply_chars"
            type="number"
            min={200}
            max={2000}
            step={50}
            defaultValue={values.maxReplyChars}
          />
        </Field>

        <div>
          <span className="text-ui-sm text-ink-soft mb-1.5 block">How sure must it be?</span>
          <input
            name="confidence_threshold"
            type="range"
            min={0.2}
            max={0.9}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="accent-ink w-full"
            aria-label="How sure must it be"
          />
          <div className="text-ui-sm text-ink-soft mt-1 flex justify-between">
            <span>Cautious</span>
            <span>Confident</span>
          </div>
          <p className="text-ui-sm text-ink-soft mt-2">{thresholdLine(threshold)}</p>
        </div>

        <Field label="What may it do?">
          <div className="space-y-2">
            {ACTIONS.map(([value, label]) => (
              <label key={value} className="text-ui text-ink flex items-center gap-2">
                <input
                  type="checkbox"
                  name="allowed_actions"
                  value={value}
                  defaultChecked={values.allowedActions.includes(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>

        <Field
          label="Which roles may it hand out?"
          help="Only these, and only after the proof you set for each one."
        >
          {roles.length === 0 ? (
            <p className="text-ui-sm text-ink-soft">
              Sentry has not read your roles yet. Add it to the server first.
            </p>
          ) : (
            <div className="space-y-2">
              {roles.map((role) => (
                <label key={role.id} className="text-ui text-ink flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="self_serve_role_ids"
                    value={role.id}
                    defaultChecked={values.selfServeRoleIds.includes(role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          )}
        </Field>

        {state?.error && <p className="text-ui text-ink">{state.error}</p>}
        {state?.warning && (
          <Panel className="border-amber border-l-2 shadow-none">
            <p className="text-ui text-ink">{state.warning}</p>
          </Panel>
        )}
        {state?.ok && !state.error && <p className="text-ui text-ink-soft">{state.ok}</p>}

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving' : 'Save changes'}
        </Button>
      </form>

      <section className="mt-16">
        <h2 className="text-ui-sm text-ink-soft">Hear it</h2>
        <TestChat guildId={guildId} botName={values.botName || 'Sentry'} />
      </section>
    </div>
  );
}

/** What the slider means, in a sentence that changes with it. */
function thresholdLine(value: number): string {
  if (value <= 0.35) return 'It answers whenever the knowledge is roughly about the question.';
  if (value <= 0.6) return 'It answers what the knowledge covers, and asks a moderator otherwise.';
  return 'It answers only when the knowledge says it almost word for word.';
}
