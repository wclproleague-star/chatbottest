import { redirect } from 'next/navigation';

// Setup moved out of the dashboard: it has no sidebar and no chrome, so it
// lives at its own address. This keeps every old link working.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  redirect(`/setup/${guildId}`);
}
