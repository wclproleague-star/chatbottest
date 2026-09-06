'use client';

// Say what you want, read what it would do, then decide.
//
// The plan is sentences with the real names in them, and the buttons are the
// only way anything happens. A plan that touches more than three things is
// numbered rather than run together, because that is the point at which people
// stop reading a paragraph.

import { Button, GrowingInput, Panel, Section, cx } from '@kalvard/ui';

/** How long each line of the plan takes to arrive. */
const LINE_MS = 420;
import { useActionState, useEffect, useState } from 'react';
import { Beacon } from '@/components/beacon/beacon';
import { cancelIt, confirmIt, planIt } from './actions';
import type { CommandState } from './actions';

export function Commands({ guildId, examples }: { guildId: string; examples: string[] }) {
  const [state, plan, planning] = useActionState<CommandState, FormData>(planIt, null);
  const [answer, decide, deciding] = useActionState<CommandState, FormData>(confirmIt, null);
  const [cancelled, cancel, cancelling] = useActionState<CommandState, FormData>(cancelIt, null);
  const [request, setRequest] = useState('');
  // The plan is repeated back a line at a time, at reading speed, so it is
  // read rather than skipped: this is the moment before something changes.
  const [said, setSaid] = useState(0);
  const sentences = state?.kind === 'plan' ? state.sentences : null;
  useEffect(() => {
    setSaid(0);
  }, [state?.id]);
  useEffect(() => {
    if (!sentences || said >= sentences.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSaid(sentences.length);
      return;
    }
    const timer = window.setTimeout(() => setSaid((n) => n + 1), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [sentences, said]);

  const decided = answer ?? cancelled;

  // The beacon says what Kalvard is doing: steady while you think, breathing
  // while it works something out, green once it has done it.
  const reading = state?.kind === 'plan' && said < state.sentences.length;
  const light =
    planning || deciding || reading ? 'working' : decided?.kind === 'sent' ? 'green' : 'amber';

  return (
    <div>
      <Section heading="What should it do?">
        <div className="flex gap-6">
          <Beacon
            light={light}
            className="hidden h-16 w-10 shrink-0 sm:block"
            label={light === 'working' ? 'Kalvard is working' : 'Kalvard'}
          />
          <div className="min-w-0 flex-1">
            <form action={plan}>
              <input type="hidden" name="guild_id" value={guildId} />
              <GrowingInput
                name="request"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="crée un channel #finale-wcl et mets les rôles Joueur et Caster dedans"
                aria-label="What should Kalvard do?"
              />
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={planning || !request.trim()}>
                  {planning ? 'Working it out' : 'Plan it'}
                </Button>
              </div>
            </form>

            {/* Four things this server has actually switched on, so nobody has
                to guess what the box accepts. */}
            <ul className="mt-4 flex flex-wrap gap-2">
              {examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => setRequest(example)}
                    className="text-ui-sm text-ink-soft hover:text-ink border-hairline rounded-full border px-3 py-1.5 text-left"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>

            {state?.kind === 'error' && <p className="text-ui text-ink mt-6">{state.error}</p>}
            {state?.kind === 'refused' && <p className="text-ui text-ink mt-6">{state.because}</p>}

            {state?.kind === 'question' && (
              <Panel className="border-amber mt-6 border-l-2 shadow-none">
                <p className="text-ui-sm text-ink-soft">{state.because}</p>
                <p className="text-thread text-ink mt-1">{state.question}</p>
                <p className="text-ui-sm text-ink-soft mt-3">
                  Answer it in the box above and plan it again.
                </p>
              </Panel>
            )}

            {state?.kind === 'plan' && !decided && (
              <Panel className="mt-6 shadow-none">
                <p className="text-ui-sm text-ink-soft">
                  Here is what it would do. Nothing has happened.
                </p>
                {state.itemise ? (
                  <ol className="text-thread text-ink mt-3 list-decimal space-y-2 pl-5">
                    {state.sentences.map((sentence, i) => (
                      <li key={i}>{sentence}</li>
                    ))}
                  </ol>
                ) : (
                  <ul className="text-thread text-ink mt-3 space-y-2">
                    {state.sentences.map((sentence, i) => (
                      <li key={i}>{sentence}</li>
                    ))}
                  </ul>
                )}
                <div
                  className={cx(
                    'mt-5 flex items-center gap-4',
                    said < state.sentences.length && 'invisible',
                  )}
                >
                  <form action={decide}>
                    <input type="hidden" name="guild_id" value={guildId} />
                    <input type="hidden" name="command_id" value={state.commandId} />
                    <Button type="submit" disabled={deciding || cancelling}>
                      {deciding ? 'Confirming' : 'Confirm'}
                    </Button>
                  </form>
                  <form action={cancel}>
                    <input type="hidden" name="guild_id" value={guildId} />
                    <input type="hidden" name="command_id" value={state.commandId} />
                    <button
                      type="submit"
                      disabled={deciding || cancelling}
                      className="text-ui text-ink-soft hover:text-ink underline underline-offset-[3px]"
                    >
                      {cancelling ? 'Cancelling' : 'Cancel'}
                    </button>
                  </form>
                </div>
              </Panel>
            )}

            {decided?.kind === 'sent' && (
              <p className="text-ui text-ink-soft mt-6">{decided.note}</p>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
