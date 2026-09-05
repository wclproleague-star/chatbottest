import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Development only: signs the browser in from a magic-link token hash so the
// guild pages can be exercised without Discord. Not for production.

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') return new NextResponse(null, { status: 404 });
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('th');
  const next = url.searchParams.get('next') ?? '/servers';
  if (!tokenHash) return new NextResponse('missing token', { status: 400 });
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error) return new NextResponse(error.message, { status: 400 });
  return NextResponse.redirect(new URL(next, url.origin));
}
