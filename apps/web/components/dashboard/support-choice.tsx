'use client';

// Where members get help: three plain options, one question at a time with a
// default already filled in, then the plan as sentences, then one yes.
// Nothing is created until that yes, and it is the bot that creates it.

import { Button, Field, Input, Select, Option } from '@kalvard/ui';
import { useActionState, useState } from 'react';
import { supportConfirm, supportStep } from '@/app/g/[guildId]/settings/support-actions';
import type { SupportState } from '@/app/g/[guildId]/settings/support-actions';
import type { SupportMode } from '@kalvard/core';

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
}: {
  guildId: string;
  /** What the server chose before, if anything. */
  current: SupportMode | null;
  /** The channel that choice points at, by name, if any. */
  currentChannel: string | null;
  /** Onboarding moves on when the plan is confirmed; settings stays. */
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<SupportMode | null>(null);
  const [state, step, stepping] = useActionState<SupportState, FormData>(supportStep, null);
  const [confirmed, confirm, confirming] = useActionState<SupportState, FormData>(
    supportConfirm,
    null,
  );
  const showing = confirmed ?? state;

  if (showing?.kind === 'sent') {
    if (onDone) onDone();
    return <p className="text-body text-ink">{showing.note}</p>;
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
      {(showing === null || showing.kind === 'error') && !mode && (
        <ul className="divide-hairline divide-y">
          {OPTIONS.map((o) => (
            <li key={o.value} className="flex items-start justify-between gap-6 py-4">
              <div>
                <p className="text-body text-ink">{o.label}</p>
                <p className="text-ui-sm text-ink-soft mt-1 max-w-[56ch]">{o.what}</p>
              </div>
              <form action={step}>
                <input type="hidden" name="guild_id" value={guildId} />
                <input type="hidden" name="mode" value={o.value} />
                <input type="hidden" name="answers" value="{}" />
                <Button
                  type="submit"
                  variant="secondary"
                  onClick={() => setMode(o.value)}
                  disabled={stepping}
                >
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
        <form action={step} className="space-y-4">
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
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
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
            <form action={confirm}>
              <input type="hidden" name="guild_id" value={guildId} />
              <input type="hidden" name="command_id" value={showing.commandId} />
              <Button type="submit" disabled={confirming}>
                Confirm
              </Button>
            </form>
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
