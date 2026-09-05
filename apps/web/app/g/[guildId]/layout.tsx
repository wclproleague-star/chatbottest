import { Surface } from '@sentrybot/ui';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/dashboard/sidebar';
import { requireMember } from '@/lib/guild';

// The guild pages: paper only, the sidebar left, the page's content right.
// Only members get here; everyone else sees the 404.

export default async function GuildLayout({
  params,
  children,
}: {
  params: Promise<{ guildId: string }>;
  children: ReactNode;
}) {
  const { guildId } = await params;
  const { guild } = await requireMember(guildId);
  return (
    <Surface surface="paper" className="min-h-screen lg:flex">
      <Sidebar guildId={guildId} guildName={guild.name ?? guildId} />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-10 lg:px-12">{children}</main>
    </Surface>
  );
}
