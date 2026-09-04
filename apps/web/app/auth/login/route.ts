import { NextResponse } from 'next/server';
import { webEnv } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

// Starts the Discord sign-in. Supabase's Discord provider must be enabled in
// the project's dashboard; the scopes are the spec's: identify email guilds.

export async function GET() {
  const { appUrl } = webEnv();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      scopes: 'identify email guilds',
      redirectTo: `${appUrl}/auth/callback`,
    },
  });
  if (error || !data.url) {
    return NextResponse.redirect(new URL('/servers?error=login', appUrl));
  }
  return NextResponse.redirect(data.url);
}
