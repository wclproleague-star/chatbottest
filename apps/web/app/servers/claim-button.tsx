'use client';

import { Button } from '@kalvard/ui';
import { useActionState } from 'react';
import { claimGuild } from './actions';
import type { ClaimState } from './actions';

/** "Set up" as a text button. Errors appear inline, in ink, one sentence. */
export function ClaimButton({ guildId }: { guildId: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimGuild, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1 max-sm:w-full">
      <input type="hidden" name="guild_id" value={guildId} />
      <Button type="submit" disabled={pending} className="max-sm:w-full max-sm:justify-center">
        {pending ? 'Setting up' : 'Set up'}
      </Button>
      {state?.error && <p className="text-ui-sm text-ink text-right">{state.error}</p>}
    </form>
  );
}
