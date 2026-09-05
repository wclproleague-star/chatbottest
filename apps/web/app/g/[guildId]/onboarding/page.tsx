import { requireMember } from '@/lib/guild';
import { serviceClient } from '@sentrybot/core';
import { Onboarding } from './onboarding';

// Setting up the bot: talk it through or fill it in, then try it, then bring
// it to Discord and say where it may answer. One page, four steps, because an
// owner who has to find the next screen has already stopped.

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

  const channels = (meta?.channels ?? []) as { id: string; name: string }[];
  const roles = (meta?.roles ?? []) as { id: string; name: string }[];

  return (
    <Onboarding
      guildId={guildId}
      guildName={guild.name ?? guildId}
      installed={Boolean(row?.bot_installed)}
      completed={Boolean(row?.setup_completed)}
      inviteUrl={process.env.DISCORD_BOT_INVITE_URL ?? ''}
      channels={channels}
      roles={roles}
    />
  );
}
