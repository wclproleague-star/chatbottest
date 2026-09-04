// The client alone, not the pipeline: the barrel would pull unpdf and genai into this bundle.
import { serviceClient } from '@sentrybot/core/supabase';
import { NextResponse } from 'next/server';
import { fetchDiscordGuilds } from '@/lib/discord';
import { webEnv } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

// Finishes the Discord sign-in: exchanges the code for a session, then fills
// user_guilds from Discord with the provider token, which exists only now.

export async function GET(request: Request) {
  const { appUrl } = webEnv();
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/servers?error=login', appUrl));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL('/servers?error=login', appUrl));
  }

  const userId = data.session.user.id;
  const providerToken = data.session.provider_token;
  if (providerToken) {
    try {
      const guilds = await fetchDiscordGuilds(providerToken);
      const svc = serviceClient();
      // The list is a snapshot of this login: replace it whole.
      await svc.from('user_guilds').delete().eq('user_id', userId);
      if (guilds.length > 0) {
        const fetchedAt = new Date().toISOString();
        await svc.from('user_guilds').insert(
          guilds.map((g) => ({
            user_id: userId,
            guild_id: g.id,
            guild_name: g.name,
            guild_icon: g.icon,
            can_manage: g.canManage,
            fetched_at: fetchedAt,
          })),
        );
      }
    } catch {
      // The session is valid even if Discord's list did not load; the page
      // says so and offers to sign in again.
      return NextResponse.redirect(new URL('/servers?error=guilds', appUrl));
    }
  }

  return NextResponse.redirect(new URL('/servers', appUrl));
}
