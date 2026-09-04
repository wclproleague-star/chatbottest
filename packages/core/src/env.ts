import process from 'node:process';

export type Env = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiEmbedModel: string;
};

let cached: Env | undefined;

function must(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Fill it in in .env.local.`);
  return value;
}

/** Server-side environment, read once. Never import this from browser code. */
export function env(): Env {
  cached ??= {
    supabaseUrl: must('SUPABASE_URL'),
    supabaseServiceRoleKey: must('SUPABASE_SERVICE_ROLE_KEY'),
    geminiApiKey: must('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  };
  return cached;
}
