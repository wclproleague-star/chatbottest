import type { Database } from '@sentrybot/core';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { webEnv } from '@/lib/env';

/**
 * A Supabase client for server components, route handlers and server
 * actions, bound to the request's auth cookies. It runs as the signed-in
 * user, so RLS applies. The service role lives in @sentrybot/core.
 */
export async function supabaseServer() {
  const store = await cookies();
  const { supabaseUrl, supabaseAnonKey } = webEnv();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot write cookies; the middleware refreshes
          // the session on the next request instead.
        }
      },
    },
  });
}
