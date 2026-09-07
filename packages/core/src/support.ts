// Where members get help: what a server has chosen, written down.
//
// The questions and the plan are in ./support-plan, which is pure and shared
// with the browser. This is the half that touches the database.

import type { Json } from './database.types';
import type { SupportMode, SupportSetup } from './support-plan';
import { serviceClient } from './supabase';

export * from './support-plan';

/** What a server has chosen, or null when it has not. */
export async function loadSupport(
  guildId: string,
): Promise<{ mode: SupportMode | null; channelId: string | null; setup: SupportSetup | null }> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('support_mode, support_channel_id, support_setup')
    .eq('guild_id', guildId)
    .maybeSingle();
  const mode = data?.support_mode as SupportMode | null | undefined;
  return {
    mode: mode ?? null,
    channelId: data?.support_channel_id ?? null,
    setup: (data?.support_setup as SupportSetup | null) ?? null,
  };
}

/** Writes the choice, once the plan that makes it real has run. */
export async function saveSupport(
  guildId: string,
  setup: SupportSetup,
  roomId: string | null,
): Promise<void> {
  const { error } = await serviceClient()
    .from('guild_settings')
    .update({
      support_mode: setup.mode,
      support_channel_id: roomId,
      support_setup: setup as unknown as Json,
    })
    .eq('guild_id', guildId);
  if (error) throw new Error(`Could not save where members get help: ${error.message}`);
}

/** The next ticket's number, written back so two tickets never share one. */
export async function nextTicketNumber(guildId: string): Promise<number> {
  const { setup } = await loadSupport(guildId);
  if (!setup) return 1;
  const n = (setup.lastTicket ?? 0) + 1;
  await serviceClient()
    .from('guild_settings')
    .update({ support_setup: { ...setup, lastTicket: n } as unknown as Json })
    .eq('guild_id', guildId);
  return n;
}
