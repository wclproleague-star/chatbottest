import { serviceClient } from '@kalvard/core';
import { PageTitle } from '@/components/dashboard/page-title';
import { requireMember } from '@/lib/guild';
import { standing } from '@/lib/standing';
import { PersonalityForm } from './personality-form';

// How the bot talks. The dry-run test chat sits underneath it, because a
// change of voice is something you hear rather than something you imagine.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireMember(guildId);
  const db = serviceClient();

  const [{ data: settings }, { data: meta }, now] = await Promise.all([
    db.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    db.from('guild_discord_meta').select('roles').eq('guild_id', guildId).maybeSingle(),
    standing(guildId),
  ]);

  return (
    <div>
      <PageTitle
        title="Personality"
        lede="How it talks, and how sure it has to be before it answers."
        light={now.light}
        standing={now.line}
      />
      <PersonalityForm
        guildId={guildId}
        basedOn={settings?.updated_at ?? null}
        roles={(meta?.roles ?? []) as { id: string; name: string }[]}
        values={{
          botName: settings?.bot_name ?? 'Kalvard',
          persona: settings?.persona_prompt ?? '',
          language: settings?.language ?? '',
          toneSample: settings?.tone_sample ?? '',
          forbidden: settings?.forbidden_topics ?? [],
          maxReplyChars: settings?.max_reply_chars ?? 900,
          threshold: settings?.confidence_threshold ?? 0.55,
          allowedActions: settings?.allowed_actions ?? [],
          selfServeRoleIds: settings?.self_serve_role_ids ?? [],
        }}
      />
    </div>
  );
}
