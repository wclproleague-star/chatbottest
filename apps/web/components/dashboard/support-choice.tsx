'use client';

// Where members get help: three plain options, one question at a time with a
// default already filled in, then the plan as sentences, then one yes.
// Nothing is created until that yes, and it is the bot that creates it.

import { Button, Field, Select, Option, cx } from '@kalvard/ui';
import { useActionState, useEffect, useRef, useState } from 'react';
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

/**
 * A field you can type in, with what this server actually has under it.
 *
 * The browser's own list for an input is a white box in the middle of a night
 * page, and it shows the value under the label as if they were two different
 * answers. This is the same thing in the page's materials: type anything, or
 * take one of theirs.
 */
function Combobox({
  name,
  initial,
  options,
}: {
  name: string;
  initial: string;
  options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  // Until they type, the field holds a proposal rather than a search: filtering
  // by it would hide every other answer behind a value they did not write.
  const [typing, setTyping] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  /** The panel clips what overflows it, so the field makes room for its list. */
  function makeRoom() {
    window.setTimeout(
      () => wrap.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      0,
    );
  }
  const typed = value.trim().toLowerCase();
  const matches = !typing
    ? options
    : options.filter(
        (o) => o.label.toLowerCase().includes(typed) || o.value.toLowerCase().includes(typed),
      );
  const shown = open && matches.length > 0;

  function take(option: { value: string; label: string }) {
    setValue(option.value);
    setTyping(false);
    setOpen(false);
  }

  return (
    <div ref={wrap} className="relative scroll-mt-4">
      {/* The chevron says the field opens; pressing it opens it. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show the list"
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((was) => !was);
          makeRoom();
        }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center"
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          aria-hidden
          className={cx(
            'text-star/50 duration-(--duration-hover) transition-transform',
            open && 'rotate-180',
          )}
        >
          <path
            d="m4 6.5 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        name={name}
        value={value}
        autoComplete="off"
        onChange={(event) => {
          setValue(event.target.value);
          setTyping(true);
          setOpen(true);
          setAt(0);
        }}
        onFocus={() => {
          setOpen(true);
          makeRoom();
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!shown) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setAt((n) => Math.min(n + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setAt((n) => Math.max(n - 1, 0));
          } else if (event.key === 'Enter' && matches[at]) {
            event.preventDefault();
            take(matches[at]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="border-star/25 text-star placeholder:text-star/40 focus:border-amber h-11 w-full rounded-lg border bg-transparent pl-3 pr-10 text-[15px] outline-none transition-colors"
      />
      {shown && (
        <ul
          className="border-star/20 absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-[184px] overflow-y-auto rounded-lg border py-1"
          style={{
            backgroundColor: 'rgba(10, 14, 20, 0.96)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
          }}
        >
          {matches.map((option, i) => (
            <li key={option.value}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  take(option);
                }}
                onMouseEnter={() => setAt(i)}
                className={cx(
                  'text-ui block w-full px-3 py-2 text-left transition-colors',
                  i === at ? 'bg-star/10 text-star' : 'text-star/75',
                )}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One or more of what the server has. A ticket that needs a human may need
 * two kinds of them — the staff and the moderators — and choosing between
 * them is not a decision anybody should be made to take.
 */
function MultiPick({
  name,
  initial,
  options,
}: {
  name: string;
  initial: string;
  options: { value: string; label: string }[];
}) {
  const [picked, setPicked] = useState<string[]>(
    initial
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
  return (
    <div>
      <input type="hidden" name={name} value={picked.join(', ')} />
      <div className="border-star/20 max-h-[184px] overflow-y-auto rounded-lg border py-1">
        {options.map((option) => {
          const on = picked.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked((all) =>
                  on ? all.filter((v) => v !== option.value) : [...all, option.value],
                )
              }
              className={cx(
                'text-ui hover:bg-star/5 flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                on ? 'text-star' : 'text-star/70',
              )}
            >
              <span
                aria-hidden
                className={cx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                  on ? 'border-amber bg-amber text-night' : 'border-star/35',
                )}
              >
                {on && (
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                    <path
                      d="M2.5 6.2 5 8.6l4.5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-ui-sm text-star/55 mt-2">
        {picked.length === 0 ? 'Pick at least one.' : `${picked.join(', ')} will be brought in.`}
      </p>
    </div>
  );
}

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
            {showing.question.many ? (
              <MultiPick
                key={showing.question.key}
                name="answer"
                initial={showing.question.suggested}
                options={showing.question.options ?? []}
              />
            ) : showing.question.options && !showing.question.freeText ? (
              // Keyed by the question: without it the field keeps the answer
              // to the last one, which matches nothing here and shows blank.
              <Select
                key={showing.question.key}
                name="answer"
                defaultValue={showing.question.suggested}
              >
                {showing.question.options.map((opt) => (
                  <Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Option>
                ))}
              </Select>
            ) : (
              <Combobox
                key={showing.question.key}
                name="answer"
                initial={showing.question.suggested}
                options={showing.question.options ?? []}
              />
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
