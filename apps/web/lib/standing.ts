import { serviceClient } from '@kalvard/core';
import type { Light } from '@/components/sky/beacon';

// What a server's vard is doing right now, for the pages that show it beside
// their title. The same reading as /servers, so a light never means two things
// in two places: green only when it actually answered somebody in the last
// hour, amber when it is watching, off when it is not answering at all.

const HOUR = 60 * 60 * 1000;

export async function standing(guildId: string): Promise<{ light: Light; line: string }> {
  const db = serviceClient();
  const [{ data: guild }, { data: last }, { count: waiting }] = await Promise.all([
    db
      .from('guilds')
      .select('bot_installed, setup_completed')
      .eq('guild_id', guildId)
      .maybeSingle(),
    db
      .from('bot_events')
      .select('created_at')
      .eq('guild_id', guildId)
      .eq('type', 'answered')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('status', 'pending'),
  ]);

  if (!guild?.bot_installed || !guild.setup_completed) {
    return { light: 'off', line: 'Your vard is dark: setup is not finished.' };
  }
  const recent = last?.created_at ? Date.now() - new Date(last.created_at).getTime() < HOUR : false;
  if (recent) return { light: 'green', line: 'Your vard answered somebody in the last hour.' };
  if ((waiting ?? 0) > 0) {
    return { light: 'amber', line: `Your vard is lit, and ${waiting} waiting on you.` };
  }
  return { light: 'amber', line: 'Your vard is lit. Nothing is waiting on you.' };
}
