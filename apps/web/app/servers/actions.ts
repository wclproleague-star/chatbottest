'use server';

import { serviceClient } from '@kalvard/core/supabase';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export type ClaimState = { error: string } | null;

/**
 * Claims a Discord server for the signed-in user. RLS stops a user inserting
 * a guild they are not yet a member of, so the writes run as the service role
 * after checking, from user_guilds, that Discord lets this user manage it.
 * The first claimer owns the guild; later managers join as editors.
 */
export async function claimGuild(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const guildId = String(formData.get('guild_id') ?? '');
  if (!/^\d{5,25}$/.test(guildId)) return { error: 'That server id is not valid.' };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: userGuild } = await supabase
    .from('user_guilds')
    .select('guild_id, guild_name, can_manage')
    .eq('user_id', user.id)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (!userGuild)
    return { error: 'That server is not in your Discord list. Sign in again to refresh it.' };
  if (!userGuild.can_manage) {
    return { error: 'You need Manage Server on that Discord server to set it up.' };
  }

  const svc = serviceClient();
  const { data: existing, error: readError } = await svc
    .from('guilds')
    .select('guild_id')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (readError) return { error: 'Could not reach the database. Try again in a moment.' };

  if (!existing) {
    const { error } = await svc
      .from('guilds')
      .insert({ guild_id: guildId, owner_user_id: user.id, name: userGuild.guild_name });
    if (error) return { error: 'Could not save the server. Try again in a moment.' };
  }

  const { error: memberError } = await svc
    .from('guild_members')
    .upsert(
      { guild_id: guildId, user_id: user.id, role: existing ? 'editor' : 'owner' },
      { onConflict: 'guild_id,user_id', ignoreDuplicates: true },
    );
  if (memberError) return { error: 'Could not add you to the server. Try again in a moment.' };

  revalidatePath('/servers');
  return null;
}
