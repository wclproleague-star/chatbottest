import { Panel, Section, Split } from '@kalvard/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import type { Light } from '@/components/sky/beacon';
import { OwnerBotCard } from './bot-card';

// The week, in four numbers and one nudge. Nothing here is a chart: an owner
// wants to know whether anything is waiting on them and whether the bot is
// getting better, and both of those are sentences.
//
// One number is the page. What is waiting on you is the only figure you can
// act on, so it is set at 72px and the three that are only news are set at 40.
// Spreading the emphasis evenly across four numbers is the same as having
// none.
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
  /** What the vard is doing this morning, from what is actually waiting. */
  light: Light;
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
      <PageTitle title="Overview" lede={`How ${data.guildName} used Kalvard this week.`} />

      <div className="mt-10">
        <Split
          left={
            <>
              {data.nudge && (
                <Panel className="border-amber border-l-2 shadow-none">
                  <p className="text-thread text-ink">{data.nudge.line}</p>
                  <a
                    href={data.nudge.href}
                    className="text-ui text-ink mt-2 inline-block underline underline-offset-[3px]"
                  >
                    {data.nudge.label}
                  </a>
                </Panel>
              )}

              <Section heading="This week">
                <dl className="grid grid-cols-3 gap-x-8 gap-y-8">
                  <Count label="Awaiting you" value={data.waiting} size={72} wide />
                  <Count label="Asked" value={data.received} size={40} />
                  <Count label="Answered" value={data.answered} size={40} />
                  <Count label="Sent to mods" value={data.toMods} size={40} />
                </dl>
              </Section>

              <Section heading="What nobody has answered yet">
                {data.pending.length === 0 ? (
                  <p className="text-body text-ink-soft">
                    Nothing is waiting. What Kalvard could not answer, somebody already did.
                  </p>
                ) : (
                  <ul className="divide-hairline -my-3 divide-y">
                    {data.pending.map((question) => (
                      <li key={question} className="text-thread text-ink py-3">
                        {question}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          }
          right={
            <>
              <Section heading="What it knows">
                <p className="display text-ink" style={{ ['--display-size' as string]: '48px' }}>
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
            </>
          }
        />
      </div>
    </div>
  );
}

function Count({
  label,
  value,
  size,
  wide,
}: {
  label: string;
  value: number;
  size: number;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-3' : undefined}>
      <dt className="text-ink-soft text-[14px]">{label}</dt>
      <dd
        className="display text-ink mt-1 tabular-nums"
        style={{ ['--display-size' as string]: `${size}px` }}
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
      line: 'Kalvard will send most questions to a moderator. Add your rules and your schedule.',
    };
  }
  if (chunks <= 50) {
    return { word: 'Decent', line: 'It answers the common questions and asks about the rest.' };
  }
  return { word: 'Solid', line: 'It answers most of what members ask without waking anyone.' };
}
