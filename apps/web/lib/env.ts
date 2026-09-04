import process from 'node:process';

/** The web app's server-side environment. Never import this from browser code. */
export type WebEnv = {
  supabaseUrl: string;
  /** The publishable key. Safe for the browser, but here it stays on the server. */
  supabaseAnonKey: string;
  appUrl: string;
};

let cached: WebEnv | undefined;

function must(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Fill it in in .env.local.`);
  return value;
}

export function webEnv(): WebEnv {
  cached ??= {
    supabaseUrl: must('SUPABASE_URL'),
    supabaseAnonKey: must('SUPABASE_ANON_KEY'),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  };
  return cached;
}
