import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { env } from './env';

// supabase-js needs a WebSocket for realtime. Node 22, which the repo pins,
// has one built in; nothing is handed in here.
function makeClient() {
  return createClient<Database>(env().supabaseUrl, env().supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
