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

import {
  CheckboxRow,
  Field,
  FormSection,
  Group,
  Input,
  Panel,
  Section,
  Slider,
  Split,
  Textarea,
  cx,
} from '@kalvard/ui';
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
    <div className="mt-10">
      <Split
        left={
          <>
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

              <Group heading="Name and voice">
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
              </Group>

              <Group heading="Language">
                <Field
                  label="What language should it reply in?"
                  help="Leave empty to follow each member."
                >
                  <Input name="language" defaultValue={values.language} />
                </Field>

                <input type="hidden" name="tone_sample" value={tone} />
                <div>
                  <span className="text-ink-soft block text-[14px]">How that sounds</span>
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
                    <p className="text-ui-sm text-ink-soft mt-2">
                      Could not think of any just now.
                    </p>
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
                              s === tone
                                ? 'border-ink bg-ink text-paper'
                                : 'border-hairline text-ink',
                            )}
                          >
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Group>
            </FormSection>

            <Section
              heading="Hear it"
              lede="The same dry run as the test page, in the voice above."
            >
              <TestChat guildId={guildId} botName={values.botName || 'Kalvard'} />
            </Section>
          </>
        }
        right={
          <>
            <FormSection heading="Its limits" action={act} pending={pending} note={note}>
              {hidden}
              <input type="hidden" name="bot_name" value={values.botName} />
              <input type="hidden" name="persona_prompt" value={persona} />
              <input type="hidden" name="language" value={values.language} />
              <input type="hidden" name="tone_sample" value={tone} />

              <Field label="What should it leave to people?" help="One per line.">
                <Textarea
                  name="forbidden_topics"
                  rows={4}
                  defaultValue={values.forbidden.join('\n')}
                />
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

              <Group heading="How sure">
                <div>
                  <span className="text-ink-soft mb-2 block text-[14px]">How sure must it be?</span>
                  <input type="hidden" name="confidence_threshold" value={threshold} />
                  <Slider
                    value={threshold}
                    onValueChange={setThreshold}
                    min={0.2}
                    max={0.9}
                    step={0.05}
                    ariaLabel="How sure must it be"
                  />
                  <div className="text-ink-faint mt-2 flex max-w-[420px] justify-between text-[13px]">
                    <span>Cautious</span>
                    <span>Confident</span>
                  </div>
                  <p className="text-ui text-ink mt-3">{thresholdLine(threshold)}</p>
                </div>
              </Group>

              <Field label="What may it do?">
                <div className="-mx-2">
                  {ACTIONS.map(([value, label]) => (
                    <CheckboxRow
                      key={value}
                      name="allowed_actions"
                      value={value}
                      defaultChecked={values.allowedActions.includes(value)}
                    >
                      {label}
                    </CheckboxRow>
                  ))}
                </div>
              </Field>

              <Field
                label="Which roles may it hand out on its own?"
                help="These it gives after the proof you set for each one. Any other role a member asks for goes to the moderators, who can give it through Kalvard by telling it to."
              >
                {roles.length === 0 ? (
                  <p className="text-ui-sm text-ink-soft">
                    Kalvard has not read your roles yet. Add it to the server first.
                  </p>
                ) : (
                  <div className="-mx-2">
                    {roles.map((role) => (
                      <CheckboxRow
                        key={role.id}
                        name="self_serve_role_ids"
                        value={role.id}
                        defaultChecked={values.selfServeRoleIds.includes(role.id)}
                      >
                        {role.name}
                      </CheckboxRow>
                    ))}
                  </div>
                )}
              </Field>
            </FormSection>
          </>
        }
      />

      {state?.warning && (
        <Panel className="border-amber mt-6 border-l-2 shadow-none">
          <p className="text-ui text-ink">{state.warning}</p>
        </Panel>
      )}
    </div>
  );
}

/** What the slider means, in a sentence that changes with it. */
function thresholdLine(value: number): string {
  if (value <= 0.35) return 'It answers whenever the knowledge is roughly about the question.';
  if (value <= 0.6) return 'It answers what the knowledge covers, and asks a moderator otherwise.';
  return 'It answers only when the knowledge says it almost word for word.';
}
