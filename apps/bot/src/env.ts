import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Local dev reads the repo-root .env.local, then .env. Neither overrides a
// variable that is already set, so .env.local wins locally and Railway's own
// environment wins in production.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present. Fall through to whatever the platform provides.
  }
}

/** The bot's own environment. Supabase and Gemini keys are read by the core package. */
export function botEnv(): { token: string } {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set.');
  return { token };
}
