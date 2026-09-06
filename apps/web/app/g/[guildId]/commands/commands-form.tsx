'use client';

// Say what you want, read what it would do, then decide.
//
// The plan is sentences with the real names in them, and the buttons are the
// only way anything happens. A plan that touches more than three things is
// numbered rather than run together, because that is the point at which people
// stop reading a paragraph.

import { Button, Panel, Textarea } from '@sentrybot/ui';
import { useActionState, useState } from 'react';
import { cancelIt, confirmIt, planIt } from './actions';
import type { CommandState } from './actions';

export function Commands({ guildId }: { guildId: string }) {
  const [state, plan, planning] = useActionState<CommandState, FormData>(planIt, null);
  const [answer, decide, deciding] = useActionState<CommandState, FormData>(confirmIt, null);
  const [cancelled, cancel, cancelling] = useActionState<CommandState, FormData>(cancelIt, null);
  const [request, setRequest] = useState('');

  const decided = answer ?? cancelled;

  return (
    <div className="mt-10 max-w-[60ch]">
      <form action={plan}>
        <input type="hidden" name="guild_id" value={guildId} />
        <Textarea
          name="request"
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="crée un channel #finale-wcl et mets les rôles Joueur et Caster dedans"
          aria-label="What should Sentry do?"
        />
        <div className="mt-3">
          <Button type="submit" disabled={planning || !request.trim()}>
            {planning ? 'Working it out' : 'Plan it'}
          </Button>
        </div>
      </form>

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
          <div className="mt-5 flex items-center gap-4">
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

      {decided?.kind === 'sent' && <p className="text-ui text-ink-soft mt-6">{decided.note}</p>}
    </div>
  );
}
