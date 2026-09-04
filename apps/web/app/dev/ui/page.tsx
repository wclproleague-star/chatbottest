import {
  AVATAR_VARIANTS,
  AvatarMark,
  BotCard,
  Button,
  DISPLAY_WIDTHS,
  Display,
  Nav,
  Panel,
  PricingList,
  PricingRow,
  Surface,
  TextLink,
  ThreadMessage,
  WORDMARK_VARIANTS,
  WordmarkSvg,
  Wordmark,
} from '@sentrybot/ui';
import type { AvatarVariant, SurfaceName, WordmarkVariant } from '@sentrybot/ui';
import type { ReactNode } from 'react';
import { InboxDemo } from './inbox-demo';

// Component preview. Same tokens on paper and on night. ?surface=paper|night
// renders one surface on its own for screenshots.

const WORDMARKS = Object.keys(WORDMARK_VARIANTS) as WordmarkVariant[];
const AVATARS = Object.keys(AVATAR_VARIANTS) as AvatarVariant[];

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

function Marks() {
  return (
    <>
      <Section label="Wordmark, three options">
        <div className="grid gap-10 md:grid-cols-3">
          {WORDMARKS.map((v) => (
            <div key={v}>
              <WordmarkSvg variant={v} height={64} className="max-w-full" />
              <p className="text-ui mt-4">
                <Wordmark variant={v} className="mr-3" />
                <span className="text-(--surface-fg-soft)">
                  {WORDMARK_VARIANTS[v].label}, width {WORDMARK_VARIANTS[v].stretch}, tracking{' '}
                  {WORDMARK_VARIANTS[v].tracking}
                </span>
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Avatar mark, three options, at 96 and 32">
        <div className="grid gap-10 md:grid-cols-3">
          {AVATARS.map((v) => (
            <div key={v}>
              <div className="flex items-end gap-6">
                <AvatarMark variant={v} size={96} />
                <AvatarMark variant={v} size={32} />
              </div>
              <p className="text-ui mt-4">
                {AVATAR_VARIANTS[v].label}
                <span className="text-(--surface-fg-soft)"> {AVATAR_VARIANTS[v].idea}</span>
              </p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function Paper() {
  return (
    <Surface surface="paper" className="min-h-screen">
      <div className="max-w-page mx-auto px-6 py-16 md:py-24">
        <Section label="Nav on paper">
          <Nav state="paper" />
        </Section>

        <Section label="Display, three widths on the width axis. The default is Slight.">
          <div className="space-y-12">
            {DISPLAY_WIDTHS.map((w) => (
              <div key={w.width}>
                <p className="text-ui-sm text-(--surface-fg-soft) mb-3">
                  {w.label}, {w.width}
                </p>
                <Display width={w.width} className="max-w-[18ch]">
                  The server assistant that asks before it answers.
                </Display>
              </div>
            ))}
          </div>
        </Section>

        <Section label="Body, button, text link">
          <p className="max-w-[68ch]">
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

        <Section label="Inbox rows, three transitions. Hover or tap Approve on the amber row.">
          <InboxDemo />
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
          <Nav state="sky" />
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
