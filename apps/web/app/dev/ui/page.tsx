import {
  AvatarMark,
  BotCard,
  Button,
  Display,
  InboxRow,
  Nav,
  Panel,
  PricingList,
  PricingRow,
  Surface,
  TextLink,
  ThreadMessage,
  Wordmark,
} from '@sentrybot/ui';
import type { InboxRowProps, SurfaceName } from '@sentrybot/ui';
import type { ReactNode } from 'react';

// Component preview. Same tokens on paper and on night. ?surface=paper|night
// renders one surface on its own for screenshots.

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-24 first:mt-0">
      <p className="text-ui-sm text-(--surface-fg-soft) mb-6">{label}</p>
      {children}
    </section>
  );
}

function Thread() {
  return (
    <Panel className="max-w-[520px] space-y-5">
      <ThreadMessage role="member" name="kestrel">
        when&apos;s the finals bracket posted?
      </ThreadMessage>
      <ThreadMessage role="sentry" name="Sentry" state="answered">
        Sunday 18:00 CET, in #announcements. Check-in closes an hour before.
      </ThreadMessage>
      <ThreadMessage role="member" name="kestrel">
        and if my duo can&apos;t make check-in?
      </ThreadMessage>
      <ThreadMessage role="sentry" name="Sentry" state="waiting">
        Not sure about that one. Asking @Mods.
      </ThreadMessage>
      <ThreadMessage role="mod" name="Mods">
        One sub allowed if declared before check-in.
      </ThreadMessage>
      <ThreadMessage role="sentry" name="Sentry" state="answered" typing>
        Got it. Next time I&apos;ll know.
      </ThreadMessage>
    </Panel>
  );
}

/** Three real rows. Two green, one amber. Placeholder copy until line 13. */
const ROWS: InboxRowProps[] = [
  {
    question: 'where do I find the map pool?',
    asker: 'kestrel',
    channel: 'help',
    draft: "It's pinned in #match-info.",
    almostKnew:
      'Roles and channels: #match-info holds the map pool, reschedule requests and casting requests.',
    state: 'answered',
    followUp: 'Added to what I know.',
  },
  {
    question: 'what if the other captain ignores my reschedule request?',
    asker: 'juno',
    channel: 'help',
    draft:
      'Reschedules need both captains to agree, asked in #match-info 48 hours ahead. If they will not reply, that is one for the mods.',
    almostKnew:
      'Tournament format: reschedule requests go to #match-info at least 48 hours before the match and need both captains to agree.',
    state: 'waiting',
    followUp: 'Added to what I know.',
  },
  {
    question: 'can I stream my own matches?',
    asker: 'mara',
    channel: 'general',
    draft: 'Yes. Post the link in #self-promo only.',
    almostKnew: 'Server rules: post your own streams and videos in #self-promo only.',
    state: 'answered',
    followUp: 'Added to what I know.',
  },
];

function Marks() {
  return (
    <Section label="Wordmark and avatar mark">
      <div className="flex flex-wrap items-end gap-x-16 gap-y-8">
        <Wordmark className="text-[64px]" />
        <Wordmark className="text-ui" />
        <div className="flex items-end gap-6">
          <AvatarMark size={96} />
          <AvatarMark size={32} />
        </div>
      </div>
    </Section>
  );
}

function Paper() {
  return (
    <Surface surface="paper" className="min-h-screen">
      <div className="max-w-page mx-auto px-6 py-16 md:py-24">
        <Section label="Nav on paper">
          <Nav pill />
        </Section>

        <Section label="Display, body, button, text link">
          <Display className="max-w-[18ch]">
            The server assistant that asks before it answers.
          </Display>
          <p className="mt-8 max-w-[68ch]">
            It answers from what your server already knows, and asks a moderator when it
            doesn&apos;t. The approved answer becomes new knowledge.
          </p>
          <div className="mt-6 flex items-center gap-6">
            <Button>Set up your bot</Button>
            <TextLink href="#">See how it learns</TextLink>
          </div>
        </Section>

        <Section label="Panel with the thread">
          <Thread />
        </Section>

        <Section label="Inbox rows. Hover or tap Approve on the amber row.">
          <Panel className="divide-(color:--surface-hairline) divide-y py-1">
            {ROWS.map((row) => (
              <InboxRow key={row.question} {...row} />
            ))}
          </Panel>
        </Section>

        <Section label="Bot card">
          <BotCard
            className="max-w-[640px]"
            values={{
              name: 'Sentry',
              tone: 'Short and exact. Gives the time, the channel, and the deadline.',
              language: 'English',
              knows: 'Decent. 3 documents.',
              wontTouch:
                'Bans and appeals, payments and refunds, personal disputes, staff-only info.',
              wakes: '@Mods',
            }}
          />
        </Section>

        <Section label="Pricing rows. Placeholder names and prices until line 13.">
          <PricingList className="max-w-[820px]">
            <PricingRow
              name="Community"
              line="One server, its mods, and the questions members already ask."
              price="Free"
            />
            <PricingRow
              name="Club"
              line="A few servers, uploads, and the inbox for a small team."
              price="12 a month"
            />
            <PricingRow
              name="Company"
              line="A community plus the people who run it, with a private space for staff."
              price="49 a month"
            />
          </PricingList>
        </Section>

        <Marks />
      </div>
    </Surface>
  );
}

function Night() {
  return (
    <Surface surface="night" className="min-h-screen">
      <div className="max-w-page mx-auto px-6 py-16 md:py-24">
        <Section label="Nav over the sky">
          <Nav pill={false} />
        </Section>

        <Section label="Display, body, button, text link">
          <Display className="max-w-[18ch]">
            The server assistant that asks before it answers.
          </Display>
          <p className="mt-8 max-w-[68ch]">
            It answers from what your server already knows, and asks a moderator when it
            doesn&apos;t.
          </p>
          <div className="mt-6 flex items-center gap-6">
            <Button>Set up your bot</Button>
            <TextLink href="#">See how it learns</TextLink>
          </div>
        </Section>

        <Section label="Panel with the thread, night shadow">
          <Thread />
        </Section>

        <Marks />
      </div>
    </Surface>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>;
}) {
  const { surface } = await searchParams;
  const only: SurfaceName | undefined =
    surface === 'paper' || surface === 'night' ? surface : undefined;
  return (
    <main>
      {only !== 'night' && <Paper />}
      {only !== 'paper' && <Night />}
    </main>
  );
}
