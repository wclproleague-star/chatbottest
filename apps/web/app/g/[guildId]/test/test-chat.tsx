'use client';

import type { AnswerResult, HistoryTurn } from '@sentrybot/core';
import { Button, Input, Panel, ThreadMessage } from '@sentrybot/ui';
import { useEffect, useRef, useState } from 'react';
import { ask, suggest } from './actions';

// The test chat, on paper: your messages in a white panel on the right,
// Sentry's as plain text on the left with the 2px green rule. When it would
// not answer, a distinct card says so, with the draft and the reason.
// "Generate test questions" reads the knowledge and offers six to try.

type Turn =
  { id: number; role: 'user'; text: string } | { id: number; role: 'sentry'; result: AnswerResult };

export function TestChat({ guildId, botName }: { guildId: string; botName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setDraft('');
    const history = turns.flatMap((t): HistoryTurn[] => {
      if (t.role === 'user') return [{ role: 'user' as const, text: t.text }];
      if (t.result.answered) return [{ role: 'model' as const, text: t.result.answer }];
      return [{ role: 'model' as const, text: 'Not sure about that one. Asking a moderator.' }];
    });
    setTurns((all) => [...all, { id: Date.now(), role: 'user', text: q }]);
    setPending(true);
    const outcome = await ask(guildId, q, history);
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
            <Reply key={t.id} result={t.result} botName={botName} />
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

/** Sentry's turn: the answer with the green rule, or the card for what it would hand to a mod. */
function Reply({ result, botName }: { result: AnswerResult; botName: string }) {
  if (result.answered) {
    return (
      <ThreadMessage role="sentry" name={botName} state="answered">
        {result.answer}
      </ThreadMessage>
    );
  }
  const reason =
    result.reason === 'no_knowledge'
      ? 'Nothing in the knowledge covers this.'
      : result.reason === 'refused'
        ? `It touches a topic Sentry is told to leave to people${result.refusalReason ? `: ${result.refusalReason}` : '.'}`
        : `Not confident enough: ${result.confidence.toFixed(2)}, under the threshold.`;
  const draft = result.reason === 'no_knowledge' ? null : result.draft;
  return (
    <div data-state="waiting" className="max-w-[80%]">
      <Panel className="border-amber border-l-2 shadow-none">
        <p className="text-ui-sm text-ink-soft">{botName}</p>
        <p className="text-thread mt-1">In Discord, this is where I&apos;d ask a mod.</p>
        {draft && (
          <p className="text-thread text-ink-soft mt-3">
            <span className="text-ink">What it almost said: </span>
            {draft}
          </p>
        )}
        <p className="text-ui-sm text-ink-soft mt-3">{reason}</p>
      </Panel>
    </div>
  );
}
