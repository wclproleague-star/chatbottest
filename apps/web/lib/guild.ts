import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * The signed-in user's access to a guild page. Signed out: to sign in. Not a
 * member (or no such guild): the 404, which says nothing about whether the
 * guild exists. Returns the user's client, so RLS applies to what follows.
 */
export async function requireMember(guildId: string) {
  if (!/^\d{5,25}$/.test(guildId)) notFound();
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const [{ data: membership }, { data: guild }] = await Promise.all([
    supabase
      .from('guild_members')
      .select('role')
      .eq('guild_id', guildId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('guilds').select('guild_id, name').eq('guild_id', guildId).maybeSingle(),
  ]);
  if (!membership || !guild) notFound();

  return { supabase, user, guild, role: membership.role };
}

/** The user's display name for the test chat: Discord's, or the email's local part. */
export function displayName(user: { email?: string; user_metadata: Record<string, unknown> }) {
  const meta = user.user_metadata;
  const name = meta.full_name ?? meta.name ?? meta.preferred_username ?? meta.user_name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return user.email?.split('@')[0] ?? 'you';
}
