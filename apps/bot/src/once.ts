// Doing a thing once, however many times Discord tells us about it.
//
// The gateway redelivers on reconnect, and a resumed session can replay what it
// already sent. Answering a member twice is worse than answering late, so every
// event that leads to a write is claimed by id first: the claim is a primary
// key, so two workers racing on the same event have exactly one winner.

import { serviceClient } from '@kalvard/core/supabase';

/**
 * Claims this event. True means it is ours to handle; false means it has been
 * handled already. A database that cannot be reached returns true: answering
 * twice in an outage is better than going silent in one.
 */
export async function claim(id: string, kind: string, guildId?: string): Promise<boolean> {
  try {
    const { error } = await serviceClient()
      .from('processed_events')
      .insert({ id: `${kind}:${id}`, kind, guild_id: guildId ?? null });
    if (!error) return true;
    // 23505 is the unique violation: somebody else already has this one.
    if ((error as { code?: string }).code === '23505') return false;
    console.error(`kalvard: could not claim ${kind} ${id}: ${error.message}`);
    return true;
  } catch (err) {
    console.error(`kalvard: could not claim ${kind} ${id}: ${String(err)}`);
    return true;
  }
}

/** Drops claims older than a day; nothing is redelivered that late. */
export async function sweepClaims(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await serviceClient().from('processed_events').delete().lt('created_at', cutoff);
}
