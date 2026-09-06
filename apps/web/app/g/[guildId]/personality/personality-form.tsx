'use client';

// How the bot talks, and how careful it is: two subjects, two panels.
//
// The line in its voice is not a field. Nobody sits down to write one, and a
// box asking for one gets an empty box; what it is for is to hear the persona
// you just wrote, so it is shown as a quoted line Kalvard wrote, with the way
// to ask for three more underneath it.
//
// The form carries the version it was opened with, so two people editing at
// once find out rather than overwriting each other. Below it, the same dry-run
// test chat as the Test page: a change of voice is something you hear, not
// something you imagine.

import { Field, FormSection, Input, Panel, Section, Textarea, cx } from '@kalvard/ui';
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

  const note = state?.error ? (
    <p className="text-ui text-ink mr-auto">{state.error}</p>
  ) : state?.ok ? (
    <p className="text-ui text-ink-soft mr-auto">{state.ok}</p>
  ) : null;

  const hidden = (
    <>
      <input type="hidden" name="guild_id" value={guildId} />
      <input type="hidden" name="based_on" value={basedOn ?? ''} />
    </>
  );

  return (
    <div className="mt-10 space-y-8">
      <FormSection
        heading="Its voice"
        action={act}
        pending={pending}
        note={note}
        changed={tone !== values.toneSample}
      >
        {hidden}
        {/* What the other panel holds, so a save here writes the whole row. */}
        <input type="hidden" name="forbidden_topics" value={values.forbidden.join('\n')} />
        <input type="hidden" name="max_reply_chars" value={values.maxReplyChars} />
        <input type="hidden" name="confidence_threshold" value={values.threshold} />
        {values.allowedActions.map((a) => (
          <input key={a} type="hidden" name="allowed_actions" value={a} />
        ))}
        {values.selfServeRoleIds.map((r) => (
          <input key={r} type="hidden" name="self_serve_role_ids" value={r} />
        ))}

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

        <Field label="What language should it reply in?" help="Leave empty to follow each member.">
          <Input name="language" defaultValue={values.language} />
        </Field>

        <input type="hidden" name="tone_sample" value={tone} />
        <div>
          <span className="text-ui-sm text-ink-soft block">How that sounds</span>
          {tone ? (
            <blockquote className="text-thread text-ink border-green mt-2 border-l-2 pl-3">
              {tone}
            </blockquote>
          ) : (
            <p className="text-ui-sm text-ink-soft mt-2">
              Nothing yet. Ask for three and pick the one that sounds like your server.
            </p>
          )}
          <button
            type="button"
            onClick={() => void newSamples()}
            disabled={thinking}
            className="text-ui-sm text-ink-soft hover:text-ink mt-3 underline underline-offset-[3px] disabled:opacity-40"
          >
            {thinking ? 'Writing three' : 'Write me three'}
          </button>
          {samples && samples.length === 0 && (
            <p className="text-ui-sm text-ink-soft mt-2">Could not think of any just now.</p>
          )}
          {samples && samples.length > 0 && (
            <ul className="mt-3 space-y-2">
              {samples.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setTone(s)}
                    className={cx(
                      'text-ui-sm block w-full rounded-lg border px-4 py-2 text-left',
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
      </FormSection>

      <FormSection heading="Its limits" action={act} pending={pending} note={note}>
        {hidden}
        <input type="hidden" name="bot_name" value={values.botName} />
        <input type="hidden" name="persona_prompt" value={persona} />
        <input type="hidden" name="language" value={values.language} />
        <input type="hidden" name="tone_sample" value={tone} />

        <Field label="What should it leave to people?" help="One per line.">
          <Textarea name="forbidden_topics" rows={4} defaultValue={values.forbidden.join('\n')} />
        </Field>

        <Field label="How long may a reply be?" help="In characters. 900 is about six lines.">
          <Input
            name="max_reply_chars"
            type="number"
            width="number"
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
            className="accent-ink w-full max-w-[420px]"
            aria-label="How sure must it be"
          />
          <div className="text-ui-sm text-ink-soft mt-1 flex max-w-[420px] justify-between">
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
              Kalvard has not read your roles yet. Add it to the server first.
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
      </FormSection>

      {state?.warning && (
        <Panel className="border-amber border-l-2 shadow-none">
          <p className="text-ui text-ink">{state.warning}</p>
        </Panel>
      )}

      <Section heading="Hear it" lede="The same dry run as the test page, in the voice above.">
        <TestChat guildId={guildId} botName={values.botName || 'Kalvard'} />
      </Section>
    </div>
  );
}

/** What the slider means, in a sentence that changes with it. */
function thresholdLine(value: number): string {
  if (value <= 0.35) return 'It answers whenever the knowledge is roughly about the question.';
  if (value <= 0.6) return 'It answers what the knowledge covers, and asks a moderator otherwise.';
  return 'It answers only when the knowledge says it almost word for word.';
}
