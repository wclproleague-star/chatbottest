import { serviceClient } from '@sentrybot/core';
import { PageTitle } from '@/components/dashboard/page-title';
import { formatDate } from '@/lib/format';
import { requireMember } from '@/lib/guild';
import { Inbox } from './inbox-rows';
import type { Answered, Waiting } from './inbox-rows';

// What Sentry could not answer, waiting on a person. Answering here posts to
// the member in the channel they asked in and becomes knowledge at the same
// time, which is the whole loop the product is built around.

const MAX_ROWS = 50;

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireMember(guildId);
  const db = serviceClient();

  const [{ data: pending }, { data: answered }, { data: meta }] = await Promise.all([
    db
      .from('questions')
      .select('id, question, asker_name, channel_id, bot_draft, top_chunk_ids, created_at')
      .eq('guild_id', guildId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    db
      .from('questions')
      .select('id, question, asker_name, answer, answered_by, answered_at')
      .eq('guild_id', guildId)
      .eq('status', 'answered')
      .order('answered_at', { ascending: false })
      .limit(MAX_ROWS),
    db.from('guild_discord_meta').select('channels').eq('guild_id', guildId).maybeSingle(),
  ]);

  const channels = new Map(
    ((meta?.channels ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  // What it almost knew: the chunks it actually retrieved, so a moderator can
  // see whether the knowledge was missing or simply wrong.
  const chunkIds = [...new Set((pending ?? []).flatMap((q) => q.top_chunk_ids ?? []))];
  const { data: chunks } = chunkIds.length
    ? await db.from('chunks').select('id, content').in('id', chunkIds)
    : { data: [] };
  const byId = new Map((chunks ?? []).map((c) => [c.id, c.content]));

  const waiting: Waiting[] = (pending ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    asker: q.asker_name ?? 'a member',
    channel: q.channel_id ? `#${channels.get(q.channel_id) ?? 'a channel'}` : 'a channel',
    draft: q.bot_draft ?? '',
    almostKnew: (q.top_chunk_ids ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is string => Boolean(c))
      .map((c) => c.slice(0, 400)),
    askedAt: formatDate(q.created_at),
  }));

  const done: Answered[] = (answered ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    asker: q.asker_name ?? 'a member',
    answer: q.answer ?? '',
    answeredBy: q.answered_by ?? 'a moderator',
    answeredAt: q.answered_at ? formatDate(q.answered_at) : '',
  }));

  return (
    <div>
      <PageTitle
        title="Inbox"
        lede="What Sentry could not answer. Your answer goes back to the member and becomes something it knows."
      />
      <Inbox guildId={guildId} waiting={waiting} answered={done} />
    </div>
  );
}
