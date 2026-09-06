'use client';

// The inbox row, which is the core component of the dashboard.
//
// Closed, a row is what you need to triage: the question, who asked and where,
// and one line of what Kalvard said. A moderator with twenty of these wants to
// see twenty of them, not scroll past twenty reply boxes. Clicking one opens
// it in place, and only one is open at a time, so the list stays a list.
//
// Open, it shows the chunks Kalvard actually retrieved as a block of its own,
// not a grey link. A moderator who can see that can tell the difference
// between "we never wrote this down" and "we wrote it down badly", which is
// the difference between adding knowledge and fixing it. The reply box is one
// line that grows, because most answers are one sentence.

import { Button, ExpandingRow, GrowingInput, Panel, RowBlock, cx } from '@kalvard/ui';
import { Beacon } from '@/components/beacon/beacon';
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
  link: string | null;
};

export type Answered = {
  id: string;
  question: string;
  asker: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
  link: string | null;
};

export function Inbox({
  guildId,
  waiting,
  answered,
  openAt,
}: {
  guildId: string;
  waiting: Waiting[];
  answered: Answered[];
  /** Which row starts open. Only the preview page sets it. */
  openAt?: string;
}) {
  const [tab, setTab] = useState<'waiting' | 'answered'>(
    waiting.length === 0 && answered.length > 0 ? 'answered' : 'waiting',
  );
  // One at a time: opening a second closes the first.
  const [openId, setOpenId] = useState<string | null>(openAt ?? null);

  return (
    <div className="mt-10">
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
          <p className="text-body text-ink-soft">
            Nothing waiting on you. Kalvard answered everything this week.
          </p>
        ) : (
          <Panel className="divide-hairline divide-y p-0">
            {waiting.map((row) => (
              <WaitingRow
                key={row.id}
                guildId={guildId}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
              />
            ))}
          </Panel>
        )
      ) : answered.length === 0 ? (
        <p className="text-body text-ink-soft">
          Nothing answered yet. What you answer here becomes what Kalvard knows.
        </p>
      ) : (
        <Panel className="divide-hairline divide-y p-0">
          {answered.map((row) => (
            <ExpandingRow
              key={row.id}
              title={row.question}
              meta={`${row.asker} · answered by ${row.answeredBy} · ${row.answeredAt}`}
              preview={row.answer}
              state="answered"
              mark={<Mark light="green" />}
              open={openId === row.id}
              onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
              aside={<InDiscord link={row.link} />}
            >
              <RowBlock label="What was sent back">
                <p className="text-thread text-ink">{row.answer}</p>
              </RowBlock>
            </ExpandingRow>
          ))}
        </Panel>
      )}
    </div>
  );
}

function WaitingRow({
  guildId,
  row,
  open,
  onToggle,
}: {
  guildId: string;
  row: Waiting;
  open: boolean;
  onToggle: () => void;
}) {
  const [state, act, pending] = useActionState<InboxState, FormData>(answerQuestion, null);
  const [dismissState, dismiss, dismissing] = useActionState<InboxState, FormData>(
    dismissQuestion,
    null,
  );
  const done = state?.ok || dismissState?.ok;

  if (done) {
    return (
      <div className="border-green border-l-2 p-5">
        <p className="text-thread text-ink-soft">{row.question}</p>
        <p className="text-ui-sm text-ink mt-2">{done}</p>
      </div>
    );
  }

  return (
    <ExpandingRow
      title={row.question}
      meta={`${row.asker} · ${row.channel} · ${row.askedAt}`}
      preview={row.draft ? `Kalvard said: ${row.draft}` : undefined}
      state="waiting"
      mark={<Mark light="amber" />}
      open={open}
      onToggle={onToggle}
      aside={<InDiscord link={row.link} />}
    >
      <div className="space-y-4">
        {row.draft && (
          <RowBlock label="What Kalvard said">
            <p className="text-thread text-ink">{row.draft}</p>
          </RowBlock>
        )}

        <RowBlock label={`What it almost knew (${row.almostKnew.length})`}>
          {row.almostKnew.length === 0 ? (
            <p className="text-ui-sm text-ink-soft">Nothing in the knowledge came close to this.</p>
          ) : (
            <ul className="text-ui-sm text-ink-soft space-y-2">
              {row.almostKnew.map((chunk, i) => (
                <li key={i} className="border-hairline border-l pl-3">
                  {chunk}
                </li>
              ))}
            </ul>
          )}
        </RowBlock>

        <form action={act}>
          <input type="hidden" name="guild_id" value={guildId} />
          <input type="hidden" name="question_id" value={row.id} />
          <GrowingInput
            name="answer"
            maxLength={900}
            placeholder="Answer them, in a sentence. Kalvard posts it and keeps it."
            aria-label={`Answer: ${row.question}`}
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
    </ExpandingRow>
  );
}

/**
 * The vard that handed this row over, at the size of a mark. Below 64px the
 * component draws itself in vector, so it is sharp at a size where the object
 * would only be edges.
 */
function Mark({ light }: { light: 'amber' | 'green' }) {
  return (
    <Beacon
      light={light}
      className="h-7 w-[19px]"
      label={light === 'amber' ? 'Waiting on you' : 'Answered'}
    />
  );
}

/** The way back to where it was actually said. */
function InDiscord({ link }: { link: string | null }) {
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="hover:text-ink underline underline-offset-[3px]"
    >
      In Discord
    </a>
  );
}
