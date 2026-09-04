import { NextResponse } from 'next/server';
import { webEnv } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', webEnv().appUrl), { status: 303 });
}
