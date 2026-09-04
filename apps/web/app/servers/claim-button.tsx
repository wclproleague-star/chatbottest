'use client';

import { useActionState } from 'react';
import { claimGuild } from './actions';
import type { ClaimState } from './actions';

/** "Set up" as a text button. Errors appear inline, in ink, one sentence. */
export function ClaimButton({ guildId }: { guildId: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimGuild, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="guild_id" value={guildId} />
      <button
        type="submit"
        disabled={pending}
        className="text-ui text-ink decoration-ink/40 hover:decoration-ink underline underline-offset-[3px] transition-colors disabled:opacity-40"
      >
        {pending ? 'Setting up' : 'Set up'}
      </button>
      {state?.error && <p className="text-ui-sm text-ink text-right">{state.error}</p>}
    </form>
  );
}
