import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { Database } from './database.types';
import { env } from './env';

type RealtimeOptions = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>;

// supabase-js refuses to construct without a WebSocket. Node 22 has one built
// in; Node 20 does not, so hand it ws there.
function realtimeOptions(): RealtimeOptions {
  if ('WebSocket' in globalThis) return {};
  return { transport: WebSocket as unknown as NonNullable<RealtimeOptions['transport']> };
}

function makeClient() {
  return createClient<Database>(env().supabaseUrl, env().supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: realtimeOptions(),
  });
}

/** The client type as supabase-js infers it, so it never drifts from createClient. */
export type ServiceClient = ReturnType<typeof makeClient>;

let client: ServiceClient | undefined;

/** Service-role client for the bot and server-side code. It bypasses RLS. */
export function serviceClient(): ServiceClient {
  client ??= makeClient();
  return client;
}

/** Storage bucket for uploaded documents; `documents.storage_path` is the object path inside it. */
export const DOCUMENTS_BUCKET = 'documents';
