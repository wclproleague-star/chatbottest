import { Setup } from '@/app/setup/[guildId]/setup';

// The setup screens, without a session, so they can be looked at and checked
// against the design. ?step= picks which moment to show.

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const at = (step ?? 'entry') as 'entry' | 'chat' | 'form' | 'try' | 'bring' | 'finish' | 'live';
  return (
    <Setup
      preview
      startAt={at}
      guildId="900000000000000001"
      guildName="Wild Champions League"
      installed={at === 'finish'}
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
  );
}
