import { Surface } from '@sentrybot/ui';
import { Sidebar } from '@/components/dashboard/sidebar';
import { PageTitle } from '@/components/dashboard/page-title';
import { Inbox } from '@/app/g/[guildId]/inbox/inbox-rows';
import { PersonalityForm } from '@/app/g/[guildId]/personality/personality-form';
import { SettingsForm } from '@/app/g/[guildId]/settings/settings-form';
import { Commands } from '@/app/g/[guildId]/commands/commands-form';

// The dashboard screens with fixed data, so they can be looked at and checked
// against the design without a Discord session. The forms post to the real
// server actions and will refuse without one: this page is for the layout.

const CHANNELS = [
  { id: '1', name: 'announcements' },
  { id: '2', name: 'general' },
  { id: '3', name: 'match-info' },
];
const ROLES = [
  { id: '10', name: 'Moderator' },
  { id: '11', name: 'Fast Forward' },
  { id: '12', name: 'EU' },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p = 'inbox' } = await searchParams;
  return (
    <Surface surface="paper" className="min-h-screen lg:flex">
      <Sidebar guildId="900000000000000001" guildName="Wild Champions League" />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-10 lg:px-12">
        {p === 'inbox' && <InboxPreview />}
        {p === 'personality' && <PersonalityPreview />}
        {p === 'settings' && <SettingsPreview />}
        {p === 'commands' && <CommandsPreview />}
      </main>
    </Surface>
  );
}

function InboxPreview() {
  return (
    <div>
      <PageTitle
        title="Inbox"
        lede="What Sentry could not answer. Your answer goes back to the member and becomes something it knows."
      />
      <Inbox
        guildId="900000000000000001"
        waiting={[
          {
            id: 'a',
            question: 'can my duo miss check-in?',
            asker: 'kestrel',
            channel: '#general',
            draft:
              "I don't have anything on a teammate missing check-in. @Mods, can one of you take this?",
            almostKnew: [
              'Check-in opens two hours before the match and closes one hour before it starts.',
              'Both team captains must check in from #check-in.',
            ],
            askedAt: 'Sat 5 Sep',
          },
          {
            id: 'b',
            question: 'rules for subs?',
            asker: 'ephemera',
            channel: '#match-info',
            draft: "I've got nothing on substitutes. @Mods, can one of you take this?",
            almostKnew: [],
            askedAt: 'Fri 4 Sep',
          },
        ]}
        answered={[
          {
            id: 'c',
            question: 'how do I sign up for the tournament?',
            asker: 'PPG',
            answer: 'Sign-ups are in #announcements, and they close on the Friday before week one.',
            answeredBy: 'Petru',
            answeredAt: 'Thu 3 Sep',
          },
        ]}
      />
    </div>
  );
}

function PersonalityPreview() {
  return (
    <div>
      <PageTitle
        title="Personality"
        lede="How it talks, and how sure it has to be before it answers."
      />
      <PersonalityForm
        guildId="900000000000000001"
        basedOn={null}
        roles={ROLES}
        values={{
          botName: 'Sentry',
          persona: 'A competitive Wild Rift league. Short and exact, no small talk.',
          language: '',
          toneSample: 'Sunday 18:00 CET, in #announcements. Check-in closes an hour before.',
          forbidden: ['bans and appeals', 'payments and refunds'],
          maxReplyChars: 900,
          threshold: 0.55,
          allowedActions: ['point_to_channel', 'escalate'],
          selfServeRoleIds: ['11'],
        }}
      />
    </div>
  );
}

function CommandsPreview() {
  return (
    <div>
      <PageTitle
        title="Commands"
        lede="Tell Sentry what to change. It shows you the plan first, and nothing happens until you confirm."
      />
      <Commands guildId="900000000000000001" />
    </div>
  );
}

function SettingsPreview() {
  return (
    <div>
      <PageTitle title="Settings" lede="Where it answers, who it wakes, and what it may look up." />
      <SettingsForm
        guildId="900000000000000001"
        guildName="Wild Champions League"
        basedOn={null}
        channels={CHANNELS}
        roles={ROLES}
        sources={[
          {
            id: 'weather',
            name: 'the weather',
            answers: 'the weather right now anywhere',
            kind: 'open_meteo',
            address: '',
          },
          {
            id: 'league',
            name: 'the league schedule',
            answers: 'fixtures, times, results and rosters',
            kind: 'rift_legends',
            address: 'https://api.riftlegends.gg/v1',
          },
        ]}
        issues={[{ setting: 'mod_channel_id', id: '99999' }]}
        values={{
          allowedChannelIds: ['2'],
          modRoleId: '10',
          modChannelId: '',
          introChannelId: '1',
          introMessage: 'I am here. Mention me and I will answer what the server knows.',
          fallbackMode: 'ping_role',
          scope: 'open',
          timezone: 'Europe/Paris',
          memberBurst: 8,
          monthlyAnswers: 2000,
        }}
      />
    </div>
  );
}
