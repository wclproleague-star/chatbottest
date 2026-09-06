import { parseLimits, parseSources, serviceClient } from '@kalvard/core';
import { PageTitle } from '@/components/dashboard/page-title';
import { requireMember } from '@/lib/guild';
import { SettingsForm } from './settings-form';

// Everything that is not personality, plus the two things that cannot be
// undone. Anything in here that has stopped pointing at a real channel or role
// is shown at the top: the bot notices at sync, and this is where it says so.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { guild } = await requireMember(guildId);
  const db = serviceClient();

  const [{ data: settings }, { data: meta }, { data: issue }] = await Promise.all([
    db.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    db.from('guild_discord_meta').select('channels, roles').eq('guild_id', guildId).maybeSingle(),
    db
      .from('bot_events')
      .select('payload, created_at')
      .eq('guild_id', guildId)
      .eq('type', 'settings_issue')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const channels = (meta?.channels ?? []) as { id: string; name: string }[];
  const roles = (meta?.roles ?? []) as { id: string; name: string }[];
  const limits = parseLimits(settings?.limits);
  const sources = parseSources(settings?.data_sources ?? null);

  // Only what is still missing: the owner may have fixed it since.
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const reported = ((issue?.payload as { missing?: { setting: string; id: string }[] } | null)
    ?.missing ?? []) as { setting: string; id: string }[];
  const issues = reported.filter((m) =>
    m.setting.includes('role') ? !roleIds.has(m.id) : !channelIds.has(m.id),
  );

  return (
    <div>
      <PageTitle title="Settings" lede="Where it answers, who it wakes, and what it may look up." />
      <SettingsForm
        guildId={guildId}
        guildName={guild.name ?? guildId}
        basedOn={settings?.updated_at ?? null}
        channels={channels}
        roles={roles}
        sources={sources.map((s) => ({
          id: s.id,
          name: s.name,
          answers: s.answers,
          kind: s.kind,
          // The address, never the key.
          address: typeof s.config.baseUrl === 'string' ? s.config.baseUrl : '',
        }))}
        issues={issues}
        support={{
          mode:
            (settings?.support_mode as 'tickets' | 'help_channel' | 'existing_channel' | null) ??
            null,
          channel: channels.find((c) => c.id === settings?.support_channel_id)?.name ?? null,
        }}
        values={{
          allowedChannelIds: settings?.allowed_channel_ids ?? [],
          modRoleId: settings?.mod_role_id ?? '',
          modChannelId: settings?.mod_channel_id ?? '',
          introChannelId: settings?.intro_channel_id ?? '',
          introMessage: settings?.intro_message ?? '',
          fallbackMode: settings?.fallback_mode ?? 'ping_role',
          scope: settings?.scope ?? 'open',
          timezone: settings?.timezone ?? '',
          memberBurst: limits.memberBurst,
          monthlyAnswers: limits.monthlyAnswers,
          modPingsPerHour: limits.modPingsPerHour,
        }}
      />
    </div>
  );
}
