'use client';

// The inbox row, which is the core component of the dashboard: the question,
// who asked and where, what Sentry almost knew, and the box you answer in.
//
// What it almost knew is collapsed by default and opens to the actual chunks
// it retrieved. A moderator who can see that can tell the difference between
// "we never wrote this down" and "we wrote it down badly", which is the
// difference between adding knowledge and fixing it.

import { Button, Panel, Textarea, cx } from '@sentrybot/ui';
import { useActionState, useState } from 'react';
import { answerQuestion, dismissQuestion } from './actions';
import type { InboxState } from './actions';

export type Waiting = {
  id: string;
  question: string;
  asker: string;
  channel: string;
  draft: string;
  almostKnew: string[];
  askedAt: string;
};

export type Answered = {
  id: string;
  question: string;
  asker: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
};

export function Inbox({
  guildId,
  waiting,
  answered,
}: {
  guildId: string;
  waiting: Waiting[];
  answered: Answered[];
}) {
  const [tab, setTab] = useState<'waiting' | 'answered'>(
    waiting.length === 0 && answered.length > 0 ? 'answered' : 'waiting',
  );

  return (
    <div className="mt-10 max-w-[820px]">
      <div className="mb-6 flex gap-6">
        {(['waiting', 'answered'] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'true' : undefined}
            className={cx(
              'text-ui pb-1',
              tab === name
                ? 'border-ink text-ink border-b-2'
                : 'text-ink-soft hover:text-ink border-b-2 border-transparent',
            )}
          >
            {name === 'waiting' ? `Waiting on you (${waiting.length})` : 'Answered'}
          </button>
        ))}
      </div>

      {tab === 'waiting' ? (
        waiting.length === 0 ? (
          <p className="text-body text-ink-soft max-w-[60ch]">
            Nothing waiting on you. Sentry answered everything this week.
          </p>
        ) : (
          <Panel className="divide-hairline divide-y p-0">
            {waiting.map((row) => (
              <WaitingRow key={row.id} guildId={guildId} row={row} />
            ))}
          </Panel>
        )
      ) : answered.length === 0 ? (
        <p className="text-body text-ink-soft max-w-[60ch]">
          Nothing answered yet. What you answer here becomes what Sentry knows.
        </p>
      ) : (
        <Panel className="divide-hairline divide-y p-0">
          {answered.map((row) => (
            <div key={row.id} className="p-5">
              <p className="text-thread text-ink">{row.question}</p>
              <p className="text-ui-sm text-ink-soft mt-1">
                {row.asker} · answered by {row.answeredBy} · {row.answeredAt}
              </p>
              <p className="text-thread text-ink border-green mt-3 border-l-2 pl-3">{row.answer}</p>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function WaitingRow({ guildId, row }: { guildId: string; row: Waiting }) {
  const [state, act, pending] = useActionState<InboxState, FormData>(answerQuestion, null);
  const [dismissState, dismiss, dismissing] = useActionState<InboxState, FormData>(
    dismissQuestion,
    null,
  );
  const [open, setOpen] = useState(false);
  const done = state?.ok || dismissState?.ok;

  if (done) {
    return (
      <div className="p-5">
        <p className="text-thread text-ink-soft">{row.question}</p>
        <p className="text-ui-sm text-ink border-green mt-2 border-l-2 pl-3">{done}</p>
      </div>
    );
  }

  return (
    <div className="border-amber border-l-2 p-5">
      <p className="text-thread text-ink">{row.question}</p>
      <p className="text-ui-sm text-ink-soft mt-1">
        {row.asker} · {row.channel} · {row.askedAt}
      </p>

      {row.draft && (
        <p className="text-thread text-ink-soft mt-3">
          <span className="text-ui-sm text-ink-soft block">What Sentry said</span>
          {row.draft}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-ui-sm text-ink-soft hover:text-ink mt-3 block underline underline-offset-[3px]"
      >
        {open ? 'Hide what it almost knew' : `What it almost knew (${row.almostKnew.length})`}
      </button>
      {open && (
        <ul className="text-ui-sm text-ink-soft mt-2 space-y-2">
          {row.almostKnew.length === 0 && <li>Nothing in the knowledge came close to this.</li>}
          {row.almostKnew.map((chunk, i) => (
            <li key={i} className="border-hairline border-l pl-3">
              {chunk}
            </li>
          ))}
        </ul>
      )}

      <form action={act} className="mt-4">
        <input type="hidden" name="guild_id" value={guildId} />
        <input type="hidden" name="question_id" value={row.id} />
        <Textarea
          name="answer"
          rows={3}
          maxLength={900}
          placeholder="Answer them, in a sentence. Sentry posts it and keeps it."
          aria-label={`Answer: ${row.question}`}
          className="min-h-24"
        />
        {state?.error && <p className="text-ui-sm text-ink mt-2">{state.error}</p>}
        <div className="mt-3 flex items-center gap-4">
          <Button type="submit" disabled={pending || dismissing}>
            {pending ? 'Sending' : 'Answer'}
          </Button>
          <button
            type="submit"
            formAction={dismiss}
            disabled={pending || dismissing}
            className="text-ui text-ink-soft hover:text-ink underline underline-offset-[3px]"
          >
            {dismissing ? 'Dismissing' : 'Dismiss'}
          </button>
        </div>
      </form>
    </div>
  );
}
