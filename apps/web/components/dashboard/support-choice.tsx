'use client';

// Where members get help: three plain options, one question at a time with a
// default already filled in, then the plan as sentences, then one yes.
// Nothing is created until that yes, and it is the bot that creates it.

import { Button, Field, Input, Select, Option } from '@kalvard/ui';
import { useActionState, useEffect, useState } from 'react';
import { supportConfirm, supportStep } from '@/app/g/[guildId]/settings/support-actions';
import type { SupportState } from '@/app/g/[guildId]/settings/support-actions';
import { nextSupportQuestion, supportPlan } from '@kalvard/core/support-plan';
import type { GuildShape, SupportAnswers, SupportMode } from '@kalvard/core/support-plan';

const OPTIONS: { value: SupportMode; label: string; what: string }[] = [
  {
    value: 'tickets',
    label: 'A ticket system',
    what: 'Kalvard creates the category, the channel with the "Open a ticket" button, and the permissions. Each ticket is a private room.',
  },
  {
    value: 'help_channel',
    label: 'A help channel',
    what: 'Kalvard creates #help and answers there, in public.',
  },
  {
    value: 'existing_channel',
    label: 'A channel I already have',
    what: 'Pick one of your channels. Nothing is created.',
  },
];

export function SupportChoice({
  guildId,
  current,
  currentChannel,
  onDone,
  simulate,
}: {
  guildId: string;
  /** What the server chose before, if anything. */
  current: SupportMode | null;
  /** The channel that choice points at, by name, if any. */
  currentChannel: string | null;
  /** Onboarding moves on when the plan is confirmed; settings stays. */
  onDone?: () => void;
  /**
   * A walk-through: the same questions and the same plan, worked out here
   * from a server that is not real, touching nothing. It is the whole flow,
   * and it is the one thing about it that is fake.
   */
  simulate?: GuildShape;
}) {
  const [state, step, stepping] = useActionState<SupportState, FormData>(supportStep, null);
  const [confirmed, confirm, confirming] = useActionState<SupportState, FormData>(
    supportConfirm,
    null,
  );
  const [fake, setFake] = useState<SupportState>(null);
  // Starting over cannot un-run an action, so anything older than the moment
  // it was pressed is ignored instead.
  const [from, setFrom] = useState(0);
  const raw = simulate ? fake : (confirmed ?? state);
  const showing = raw && raw.id > from ? raw : null;

  /** The same walk, in the browser: ask, ask, then show the plan. */
  function pretend(form: FormData) {
    if (!simulate) return;
    const picked = String(form.get('mode') ?? '') as SupportMode;
    const answers = JSON.parse(String(form.get('answers') ?? '{}')) as SupportAnswers;
    const key = String(form.get('key') ?? '');
    const answer = String(form.get('answer') ?? '').trim();
    if (key) (answers as Record<string, string>)[key] = answer;
    const question = nextSupportQuestion(picked, answers, simulate);
    if (question) {
      setFake({ kind: 'question', mode: picked, answers, question, id: Date.now() });
      return;
    }
    const plan = supportPlan({ mode: picked, answers, shape: simulate });
    setFake(
      plan.missing
        ? { kind: 'error', error: plan.missing, mode: picked, answers, id: Date.now() }
        : {
            kind: 'plan',
            mode: picked,
            answers,
            commandId: 'simulated',
            sentences: plan.steps.map((s) => s.sentence),
            archived: plan.archived,
            id: Date.now(),
          },
    );
  }
  const ask = simulate ? pretend : step;
  const say = simulate
    ? () => {
        setFake({
          kind: 'sent',
          note: 'That is where it would stop and wait for Discord. Nothing was created.',
          id: Date.now(),
        });
      }
    : confirm;

  // Telling the caller during render would set its state in the middle of
  // ours; it is told after the paint instead.
  const done = showing?.kind === 'sent';
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);

  if (showing?.kind === 'sent') {
    return <p className="text-body text-star">{showing.note}</p>;
  }

  return (
    <div className="space-y-6">
      {current && showing === null && (
        <p className="text-ui-sm text-ink-soft">
          Today: {OPTIONS.find((o) => o.value === current)?.label.toLowerCase()}
          {currentChannel ? `, in #${currentChannel}` : ''}. Changing it never deletes anything:
          what the previous choice created is archived, and you are told what was archived.
        </p>
      )}

      {/* The choice. One at a time; picking starts the questions. */}
      {(showing === null || showing.kind === 'error') && (
        <ul className="divide-hairline divide-y">
          {OPTIONS.map((o) => (
            <li key={o.value} className="flex items-start justify-between gap-6 py-4">
              <div>
                <p className="text-body text-ink">{o.label}</p>
                <p className="text-ui-sm text-ink-soft mt-1 max-w-[56ch]">{o.what}</p>
              </div>
              <form action={ask}>
                <input type="hidden" name="guild_id" value={guildId} />
                <input type="hidden" name="mode" value={o.value} />
                <input type="hidden" name="answers" value="{}" />
                {/* No state is set here: setting it would re-render and take
                    this form away before it had submitted. */}
                <Button type="submit" variant="secondary" disabled={stepping}>
                  {current === o.value ? 'Set it up again' : 'Choose'}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {showing?.kind === 'error' && <p className="text-body text-ink">{showing.error}</p>}

      {/* One question, with its default filled in. */}
      {showing?.kind === 'question' && (
        <form action={ask} className="space-y-4">
          <input type="hidden" name="guild_id" value={guildId} />
          <input type="hidden" name="mode" value={showing.mode} />
          <input type="hidden" name="answers" value={JSON.stringify(showing.answers)} />
          <input type="hidden" name="key" value={showing.question.key} />
          <Field
            label={showing.question.question}
            help="Kalvard proposes; change it if it is not how you do it."
          >
            {showing.question.options && !showing.question.freeText ? (
              <Select name="answer" defaultValue={showing.question.suggested}>
                {showing.question.options.map((opt) => (
                  <Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Option>
                ))}
              </Select>
            ) : (
              <Input
                name="answer"
                defaultValue={showing.question.suggested}
                list={`options-${showing.question.key}`}
              />
            )}
            {showing.question.options && showing.question.freeText && (
              <datalist id={`options-${showing.question.key}`}>
                {showing.question.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </datalist>
            )}
          </Field>
          <div className="flex gap-3">
            <Button type="submit" disabled={stepping}>
              Next
            </Button>
            <Button type="button" variant="secondary" onClick={() => setFrom(Date.now())}>
              Start over
            </Button>
          </div>
        </form>
      )}

      {/* The plan, and the yes. */}
      {showing?.kind === 'plan' && (
        <div className="space-y-4">
          <p className="text-body text-ink">Here is what I would do. Nothing has happened yet.</p>
          <ol className="text-body text-ink space-y-2">
            {showing.sentences.map((line, i) => (
              <li key={i}>
                {showing.sentences.length > 3 ? `${i + 1}. ` : '• '}
                {line}
              </li>
            ))}
          </ol>
          {showing.archived.length > 0 && (
            <p className="text-ui-sm text-ink-soft">
              From the previous setup, {showing.archived.join(' and ')} will be archived, not
              deleted.
            </p>
          )}
          <div className="flex gap-3">
            <form action={say}>
              <input type="hidden" name="guild_id" value={guildId} />
              <input type="hidden" name="command_id" value={showing.commandId} />
              <Button type="submit" disabled={confirming}>
                Confirm
              </Button>
            </form>
            <Button type="button" variant="secondary" onClick={() => setFrom(Date.now())}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
