import { Setup } from '@/app/setup/[guildId]/setup';

// The setup flow as a design preview: no session, a stub conversation, and
// any step chosen from the address, so each screen can be looked at and shot
// without walking through the ones before it.
//
//   /dev/setup?step=entry | chat | form | try | bring | finish | live

type Step = 'entry' | 'chat' | 'form' | 'try' | 'bring' | 'finish' | 'live';
const STEPS: Step[] = ['entry', 'chat', 'form', 'try', 'bring', 'finish', 'live'];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; progress?: string }>;
}) {
  const { step, progress } = await searchParams;
  const startAt = STEPS.includes(step as Step) ? (step as Step) : 'entry';
  return (
    <Setup
      guildId="preview"
      guildName="Wild Champions League"
      installed={startAt === 'finish' || startAt === 'live'}
      completed={false}
      inviteUrl="https://discord.com/oauth2/authorize?client_id=0"
      channels={[
        { id: 'c1', name: 'general' },
        { id: 'c2', name: 'help' },
        { id: 'c3', name: 'staff' },
      ]}
      roles={[
        { id: 'r1', name: 'Moderator' },
        { id: 'r2', name: 'Captain' },
      ]}
      preview
      startAt={startAt}
      previewProgress={progress === undefined ? undefined : Number(progress)}
    />
  );
}
