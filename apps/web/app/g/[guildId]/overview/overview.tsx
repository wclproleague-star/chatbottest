import { Panel, Section, Sections } from '@sentrybot/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { OwnerBotCard } from './bot-card';

// The week, in four numbers and one nudge. Nothing here is a chart: an owner
// wants to know whether anything is waiting on them and whether the bot is
// getting better, and both of those are sentences.
//
// The page is separate from the queries that fill it, so it can be looked at
// on /dev/dashboard without a Discord session behind it.

export type OverviewData = {
  guildId: string;
  guildName: string;
  received: number;
  answered: number;
  toMods: number;
  waiting: number;
  /** What nobody has answered yet, oldest first. */
  pending: string[];
  /** The nudge, when there is one: what happened and where to go. */
  nudge: { line: string; href: string; label: string } | null;
  knowledge: { word: string; line: string };
  bot: {
    name: string;
    tone: string;
    language: string;
    wontTouch: string;
    wakes: string;
  };
};

export function Overview({ data }: { data: OverviewData }) {
  return (
    <div>
      <PageTitle title="Overview" lede={`How ${data.guildName} used Sentry this week.`} />

      {data.nudge && (
        <Panel className="border-amber mt-10 border-l-2 shadow-none">
          <p className="text-thread text-ink">{data.nudge.line}</p>
          <a
            href={data.nudge.href}
            className="text-ui text-ink mt-2 inline-block underline underline-offset-[3px]"
          >
            {data.nudge.label}
          </a>
        </Panel>
      )}

      <div className="mt-10">
        <Sections>
          <Section heading="This week">
            <dl className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4">
              <Count label="Asked" value={data.received} />
              <Count label="Answered" value={data.answered} />
              <Count label="Sent to mods" value={data.toMods} />
              <Count label="Awaiting you" value={data.waiting} />
            </dl>
          </Section>

          <Section heading="What nobody has answered yet">
            {data.pending.length === 0 ? (
              <p className="text-body text-ink-soft">
                Nothing is waiting. What Sentry could not answer, somebody already did.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.pending.map((question) => (
                  <li key={question} className="text-thread text-ink">
                    {question}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section heading="What it knows">
            <p className="display text-ink" style={{ ['--display-size' as string]: '32px' }}>
              {data.knowledge.word}
            </p>
            <p className="text-body text-ink-soft">{data.knowledge.line}</p>
          </Section>

          <Section heading="Your bot">
            <OwnerBotCard
              values={{
                name: data.bot.name,
                tone: data.bot.tone,
                language: data.bot.language,
                knows: data.knowledge.word,
                wontTouch: data.bot.wontTouch,
                wakes: data.bot.wakes,
              }}
            />
          </Section>
        </Sections>
      </div>
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
export function score(chunks: number): { word: string; line: string } {
  if (chunks < 10) {
    return {
      word: 'Thin',
      line: 'Sentry will send most questions to a moderator. Add your rules and your schedule.',
    };
  }
  if (chunks <= 50) {
    return { word: 'Decent', line: 'It answers the common questions and asks about the rest.' };
  }
  return { word: 'Solid', line: 'It answers most of what members ask without waking anyone.' };
}
