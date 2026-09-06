import { serviceClient } from '@sentrybot/core';
import { requireMember } from '@/lib/guild';
import { Overview, score } from './overview';

// The queries behind the overview. What it looks like is in ./overview.

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const FORTNIGHT = 14 * DAY;

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { guild } = await requireMember(guildId);
  const db = serviceClient();
  const weekAgo = new Date(Date.now() - WEEK).toISOString();

  const [answered, toMods, waiting, oldest, chunks, lastEvent, settings] = await Promise.all([
    db
      .from('bot_events')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('type', 'answered')
      .gte('created_at', weekAgo),
    db
      .from('bot_events')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .in('type', ['mod_pinged', 'low_confidence'])
      .gte('created_at', weekAgo),
    db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('status', 'pending'),
    db
      .from('questions')
      .select('question, created_at')
      .eq('guild_id', guildId)
      .eq('status', 'pending')
      .order('created_at')
      .limit(5),
    db.from('chunks').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
    db
      .from('bot_events')
      .select('created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('guild_settings')
      .select('bot_name, tone_sample, persona_prompt, language, forbidden_topics, mod_role_id')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ]);

  const answeredCount = answered.count ?? 0;
  const modsCount = toMods.count ?? 0;
  const waitingCount = waiting.count ?? 0;
  const received = answeredCount + modsCount;
  const knowledge = score(chunks.count ?? 0);

  const oldestPending = oldest.data?.[0];
  const quiet = lastEvent.data?.created_at
    ? Date.now() - new Date(lastEvent.data.created_at).getTime() > FORTNIGHT
    : true;
  const stale = oldestPending
    ? Date.now() - new Date(oldestPending.created_at).getTime() > DAY
    : false;

  return (
    <Overview
      data={{
        guildId,
        guildName: guild.name ?? 'your server',
        received,
        answered: answeredCount,
        toMods: modsCount,
        waiting: waitingCount,
        pending: (oldest.data ?? []).map((q) => q.question),
        nudge: stale
          ? {
              line: `Somebody has been waiting since ${new Date(oldestPending!.created_at).toDateString()}: "${oldestPending!.question}"`,
              href: `/g/${guildId}/inbox`,
              label: 'Answer it',
            }
          : quiet
            ? {
                line: 'Sentry has not been asked anything in a fortnight. Members may not know it is there.',
                href: `/g/${guildId}/settings`,
                label: 'Introduce it again',
              }
            : null,
        knowledge,
        bot: {
          name: settings.data?.bot_name ?? 'Sentry',
          tone: settings.data?.tone_sample ?? settings.data?.persona_prompt ?? '',
          language: settings.data?.language ?? 'the language each member writes in',
          wontTouch: (settings.data?.forbidden_topics ?? []).join(', '),
          wakes: settings.data?.mod_role_id ? 'your mod role' : 'nobody yet',
        },
      }}
    />
  );
}
