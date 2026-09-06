import { serviceClient } from '@kalvard/core';
import { requireMember } from '@/lib/guild';
import { Setup } from './setup';

// Setting a bot up, as its own place: no sidebar, no dashboard chrome, one
// decision on screen at a time. It opens at night with the beacon dark and
// ends at night with it green; in between the page is paper and the beacon is
// the card on the right, filling a fifth at a time as things are decided.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { guild } = await requireMember(guildId);

  const db = serviceClient();
  const [{ data: row }, { data: meta }] = await Promise.all([
    db
      .from('guilds')
      .select('bot_installed, setup_completed')
      .eq('guild_id', guildId)
      .maybeSingle(),
    db.from('guild_discord_meta').select('channels, roles').eq('guild_id', guildId).maybeSingle(),
  ]);

  return (
    <Setup
      guildId={guildId}
      guildName={guild.name ?? guildId}
      installed={Boolean(row?.bot_installed)}
      completed={Boolean(row?.setup_completed)}
      inviteUrl={process.env.DISCORD_BOT_INVITE_URL ?? ''}
      channels={(meta?.channels ?? []) as { id: string; name: string }[]}
      roles={(meta?.roles ?? []) as { id: string; name: string }[]}
    />
  );
}
