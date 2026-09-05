import { Surface } from '@sentrybot/ui';
import { Onboarding } from '@/app/g/[guildId]/onboarding/onboarding';

// The setup screens, without a session, so they can be looked at and checked
// against the design. The buttons call real server actions and will refuse
// without a signed-in member: this page is for the layout, not the flow.

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  // ?step=finish shows the screen an owner sees once the bot has arrived.
  const { step } = await searchParams;
  const installed = step === 'finish';
  return (
    <Surface surface="paper" className="min-h-screen">
      <main className="px-6 pb-24 pt-10 lg:px-12">
        <Onboarding
          guildId="900000000000000001"
          guildName="Wild Champions League"
          preview
          installed={installed}
          completed={false}
          inviteUrl="https://discord.com/oauth2/authorize?client_id=0"
          channels={[
            { id: '1', name: 'announcements' },
            { id: '2', name: 'general' },
            { id: '3', name: 'match-info' },
          ]}
          roles={[
            { id: '10', name: 'Moderator' },
            { id: '11', name: 'Captain' },
          ]}
        />
      </main>
    </Surface>
  );
}
