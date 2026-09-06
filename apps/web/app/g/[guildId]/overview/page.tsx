import { serviceClient } from '@sentrybot/core';
import { Panel } from '@sentrybot/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { requireMember } from '@/lib/guild';
import { OwnerBotCard } from './bot-card';

// The week, in four numbers and one nudge. Nothing here is a chart: an owner
// wants to know whether anything is waiting on them and whether the bot is
// getting better, and both of those are sentences.

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
    <div className="max-w-[880px]">
      <PageTitle
        title="Overview"
        lede={`How ${guild.name ?? 'your server'} used Sentry this week.`}
      />

      {(stale || quiet) && (
        <Panel className="border-amber mt-10 max-w-[60ch] border-l-2 shadow-none">
          <p className="text-thread text-ink">
            {stale
              ? `Somebody has been waiting since ${new Date(oldestPending!.created_at).toDateString()}: "${oldestPending!.question}"`
              : 'Sentry has not been asked anything in a fortnight. Members may not know it is there.'}
          </p>
          <a
            href={stale ? `/g/${guildId}/inbox` : `/g/${guildId}/settings`}
            className="text-ui text-ink mt-2 inline-block underline underline-offset-[3px]"
          >
            {stale ? 'Answer it' : 'Introduce it again'}
          </a>
        </Panel>
      )}

      <dl className="mt-10 grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4">
        <Count label="Asked" value={received} />
        <Count label="Answered" value={answeredCount} />
        <Count label="Sent to mods" value={modsCount} />
        <Count label="Awaiting you" value={waitingCount} />
      </dl>

      <section className="mt-16 max-w-[60ch]">
        <h2 className="text-ui-sm text-ink-soft">What nobody has answered yet</h2>
        {(oldest.data ?? []).length === 0 ? (
          <p className="text-body text-ink-soft mt-2">
            Nothing is waiting. What Sentry could not answer, somebody already did.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {(oldest.data ?? []).map((q) => (
              <li key={q.created_at} className="text-thread text-ink">
                {q.question}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16 max-w-[60ch]">
        <h2 className="text-ui-sm text-ink-soft">What it knows</h2>
        <p className="display text-ink mt-2" style={{ ['--display-size' as string]: '32px' }}>
          {knowledge.word}
        </p>
        <p className="text-body text-ink-soft mt-1">{knowledge.line}</p>
      </section>

      <section className="mt-16">
        <h2 className="text-ui-sm text-ink-soft mb-3">Your bot</h2>
        <OwnerBotCard
          values={{
            name: settings.data?.bot_name ?? 'Sentry',
            tone: settings.data?.tone_sample ?? settings.data?.persona_prompt ?? '',
            language: settings.data?.language ?? 'the language each member writes in',
            knows: knowledge.word,
            wontTouch: (settings.data?.forbidden_topics ?? []).join(', '),
            wakes: settings.data?.mod_role_id ? 'your mod role' : 'nobody yet',
          }}
        />
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ui-sm text-ink-soft">{label}</dt>
      <dd
        className="display text-ink mt-1 tabular-nums"
        style={{ ['--display-size' as string]: '32px' }}
      >
        {value}
      </dd>
    </div>
  );
}

/** The knowledge score, as a word and the sentence that explains it. */
function score(chunks: number): { word: string; line: string } {
  if (chunks < 10) {
    return {
      word: 'Thin',
      line: 'Sentry will send most questions to a moderator. Add your rules and your schedule.',
    };
  }
  if (chunks <= 50) {
    return {
      word: 'Decent',
      line: 'It answers the common questions and asks about the rest.',
    };
  }
  return {
    word: 'Solid',
    line: 'It answers most of what members ask without waking anyone.',
  };
}
