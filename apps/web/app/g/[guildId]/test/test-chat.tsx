'use client';

import { MODS } from '@sentrybot/core/tokens';
import type { AnswerResult, ConversationResult, HistoryTurn, WouldHave } from '@sentrybot/core';
import { Button, Input, Panel, ThreadMessage } from '@sentrybot/ui';
import { useEffect, useRef, useState } from 'react';
import { ask, suggest } from './actions';

// The test chat, on paper: your messages in a white panel on the right,
// Sentry's as plain text on the left with the 2px green rule.
//
// It runs the whole bot, not a simplified version of it: the same loop, the
// same tools, the same knowledge. Reads happen for real. Writes do not: each
// one appears as a "would have" line in the waiting colour, with the values it
// would have used, so an owner can see exactly what it was about to do to
// their server without it happening.

type Turn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'sentry'; result: ConversationResult };

export function TestChat({ guildId, botName }: { guildId: string; botName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // One rehearsal per page, so a conversation continues across turns the way
  // it would in a channel, and never touches one happening in Discord.
  const rehearsal = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    // Only once there is a conversation. On an empty chat this would drag the
    // page down to a box nobody has typed in yet.
    if (turns.length === 0) return;
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setDraft('');
    const history = turns.flatMap((t): HistoryTurn[] =>
      t.role === 'user'
        ? [{ role: 'user' as const, text: t.text }]
        : said(t.result).map((text) => ({ role: 'model' as const, text })),
    );
    setTurns((all) => [...all, { id: Date.now(), role: 'user', text: q }]);
    setPending(true);
    const outcome = await ask(guildId, q, history, rehearsal.current);
    setPending(false);
    if ('error' in outcome) {
      setError(outcome.error);
      return;
    }
    setTurns((all) => [...all, { id: Date.now() + 1, role: 'sentry', result: outcome.result }]);
  }

  async function generate() {
    setSuggesting(true);
    setSuggestNote(null);
    const outcome = await suggest(guildId);
    setSuggesting(false);
    if ('error' in outcome) {
      setSuggestNote(outcome.error);
      return;
    }
    if (outcome.questions.length === 0) {
      setSuggestNote('Add some knowledge first, then Sentry can suggest questions.');
      return;
    }
    setSuggestions(outcome.questions);
  }

  return (
    <div className="mt-10 max-w-[760px]">
      <p className="text-ui-sm text-ink-soft border-amber mb-8 border-l-2 pl-3">
        <span className="text-ink font-medium">Dry run.</span> Sentry reads your knowledge and your
        roles for real. Anything it would do to your server is shown, never done.
      </p>

      <div className="space-y-6" aria-live="polite">
        {turns.length === 0 && !pending && (
          <p className="text-ink-soft max-w-[60ch]">
            Nothing asked yet. Try a question a member would ask, or generate a few from the
            knowledge.
          </p>
        )}
        {turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.id} className="flex justify-end">
              <Panel className="max-w-[70%] px-4 py-3 shadow-none">
                <p className="text-thread">{t.text}</p>
              </Panel>
            </div>
          ) : (
            <Turn key={t.id} result={t.result} botName={botName} />
          ),
        )}
        {pending && (
          <ThreadMessage role="sentry" name={botName} state="answered" typing>
            {''}
          </ThreadMessage>
        )}
        {error && <p className="text-ui max-w-[60ch]">{error}</p>}
        <div ref={end} />
      </div>

      <form
        className="mt-10 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask what a member would ask"
          aria-label="Your question"
          maxLength={500}
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !draft.trim()} className="disabled:opacity-40">
          Ask
        </Button>
      </form>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={suggesting}
          className="text-ui text-ink decoration-ink/40 hover:decoration-ink underline underline-offset-[3px] transition-colors disabled:opacity-40"
        >
          {suggesting ? 'Thinking of questions' : 'Generate test questions'}
        </button>
        {suggestNote && <p className="text-ui text-ink-soft mt-3 max-w-[60ch]">{suggestNote}</p>}
        {suggestions && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void send(s)}
                  disabled={pending}
                  className="text-ui-sm text-ink border-hairline hover:bg-panel h-9 rounded-full border px-4 transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The mod mention as it would read in Discord. */
function mods(text: string): string {
  return text.split(MODS).join('@Mods');
}

/** What Sentry said, for the next turn's context. */
function said(result: ConversationResult): string[] {
  if (result.outcome === 'flagged') return [];
  if (result.outcome === 'reply' && result.graded) {
    const graded = result.graded;
    if (graded.tier === 'flagged' || graded.tier === 'ignore') return [];
    if (graded.tier === 'clarify') return [graded.question];
    if (graded.tier === 'answer') return [graded.answer];
    return [mods(graded.reply)];
  }
  return [mods(result.text)];
}

/** One turn: what Sentry said, then anything it would have done. */
function Turn({ result, botName }: { result: ConversationResult; botName: string }) {
  return (
    <div className="space-y-3">
      <Outcome result={result} botName={botName} />
      {(result.wouldHave ?? []).map((action, i) => (
        <WouldHaveLine key={`${action.tool}-${i}`} action={action} />
      ))}
    </div>
  );
}

/** A write that was described instead of done. */
function WouldHaveLine({ action }: { action: WouldHave }) {
  const args = Object.entries(action.args).filter(([, value]) => value);
  return (
    <div className="border-amber max-w-[80%] border-l-2 pl-4">
      <p className="text-ui-sm text-ink-soft">Would have</p>
      <p className="text-thread text-ink mt-0.5">{action.description}</p>
      <p className="text-ui-sm text-ink-soft mt-1">
        {action.tool}
        {args.length > 0 && ' · '}
        {args.map(([key, value]) => `${key}: ${value}`).join(' · ')}
      </p>
    </div>
  );
}

function Outcome({ result, botName }: { result: ConversationResult; botName: string }) {
  switch (result.outcome) {
    case 'flagged':
      return (
        <div className="max-w-[80%]">
          <Panel className="border-ink border-l-2 shadow-none">
            <p className="text-ui-sm text-ink-soft">{botName}</p>
            <p className="text-thread mt-1">In Discord, I would not reply to this in public.</p>
            <p className="text-ui-sm text-ink-soft mt-3">
              A quiet report goes to the mod channel: {result.note} ({result.category})
            </p>
          </Panel>
        </div>
      );
    case 'ask':
      return (
        <ThreadMessage role="sentry" name={botName} state="waiting">
          {mods(result.text)}
        </ThreadMessage>
      );
    case 'assigned':
      return (
        <ThreadMessage role="sentry" name={botName} state="answered">
          {mods(result.text)}
        </ThreadMessage>
      );
    case 'escalate':
      return (
        <div className="max-w-[80%]">
          <Panel className="border-amber border-l-2 shadow-none">
            <p className="text-ui-sm text-ink-soft">{botName}</p>
            <p className="text-thread mt-1">{mods(result.text)}</p>
            <p className="text-ui-sm text-ink-soft mt-3">
              The moderators would get this summary: {result.summary}
            </p>
          </Panel>
        </div>
      );
    case 'reply':
      return result.graded ? (
        <Graded result={result.graded} botName={botName} />
      ) : (
        <ThreadMessage role="sentry" name={botName} state="answered">
          {mods(result.text)}
        </ThreadMessage>
      );
  }
}

/**
 * A graded reply, shown by its tier: a full answer gets the green rule, and
 * the rest say what would happen next in Discord.
 */
function Graded({ result, botName }: { result: AnswerResult; botName: string }) {
  if (result.tier === 'answer') {
    return (
      <ThreadMessage role="sentry" name={botName} state="answered">
        {mods(result.answer)}
      </ThreadMessage>
    );
  }
  if (result.tier === 'partial') {
    return (
      <ThreadMessage role="sentry" name={botName} state="waiting">
        {mods(result.reply)}
      </ThreadMessage>
    );
  }
  if (result.tier === 'flagged') {
    return (
      <div className="max-w-[80%]">
        <Panel className="border-ink border-l-2 shadow-none">
          <p className="text-ui-sm text-ink-soft">{botName}</p>
          <p className="text-thread mt-1">In Discord, I would not reply to this in public.</p>
          <p className="text-ui-sm text-ink-soft mt-3">
            A quiet report goes to the mod channel: {result.note} ({result.category})
          </p>
        </Panel>
      </div>
    );
  }
  if (result.tier === 'ignore') {
    return (
      <p className="text-ui-sm text-ink-soft">
        In Discord, Sentry would say nothing: that message was for someone else.
      </p>
    );
  }
  if (result.tier === 'sensitive') {
    return (
      <div className="max-w-[80%]">
        <ThreadMessage role="sentry" name={botName} state="waiting">
          {result.reply}
        </ThreadMessage>
        <p className="text-ui-sm text-ink-soft mt-2">
          In Discord, the moderators get this quietly: {result.note}
        </p>
      </div>
    );
  }
  if (result.tier === 'quota') {
    return (
      <ThreadMessage role="sentry" name={botName} state="waiting">
        {result.reply}
      </ThreadMessage>
    );
  }
  if (result.tier === 'clarify') {
    return (
      <ThreadMessage role="sentry" name={botName} state="waiting">
        {result.question}
      </ThreadMessage>
    );
  }
  const next =
    result.reason === 'refused'
      ? `It touches a topic Sentry is told to leave to people${result.refusalReason ? `: ${result.refusalReason}` : '.'}`
      : result.found;
  return (
    <div data-state="waiting" className="max-w-[80%]">
      <Panel className="border-amber border-l-2 shadow-none">
        <p className="text-ui-sm text-ink-soft">{botName}</p>
        <p className="text-thread mt-1">In Discord, this is where I&apos;d ask a mod.</p>
        <p className="text-thread text-ink-soft mt-3">{mods(result.reply)}</p>
        <p className="text-ui-sm text-ink-soft mt-3">{next}</p>
      </Panel>
    </div>
  );
}
