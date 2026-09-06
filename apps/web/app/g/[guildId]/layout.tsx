import { Column, Surface } from '@kalvard/ui';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/dashboard/sidebar';
import { requireMember } from '@/lib/guild';
import { standing } from '@/lib/standing';

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
  const [{ guild }, now] = await Promise.all([requireMember(guildId), standing(guildId)]);
  return (
    <Surface surface="paper" theme="dark" className="min-h-screen lg:flex">
      <Sidebar
        guildId={guildId}
        guildName={guild.name ?? guildId}
        light={now.light}
        standing={now.line}
      />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-10 lg:px-12">
        <Column>{children}</Column>
      </main>
    </Surface>
  );
}
