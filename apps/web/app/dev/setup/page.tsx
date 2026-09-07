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
        'annonces',
        'general',
        'chat-fr',
        'résultats',
        'roles',
        'support',
        'tierlist',
        'scrim',
        'tutorials',
        'streamers-lounge',
        'match-history',
        'top-20',
        'welcome',
        'info-staff',
        'schedule-wcl',
        'about-us',
        'tourney-result',
      ].map((name, i) => ({ id: `c${i}`, name }))}
      categories={[
        { id: 'k1', name: 'WCL | Staff' },
        { id: 'k2', name: 'WCL | League' },
        { id: 'k3', name: 'WCL | Community' },
      ]}
      roles={[
        'Moderator',
        'Head of Staff',
        'Tournaments Staff',
        'Captain',
        'Caster',
        'Fast Forward',
        'Chromanova',
        'Train to kill',
        'Server Booster',
        'VIP',
      ].map((name, i) => ({ id: `r${i + 1}`, name }))}
      preview
      startAt={startAt}
      previewProgress={progress === undefined ? undefined : Number(progress)}
    />
  );
}
