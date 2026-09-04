#!/usr/bin/env node
// Runs the Supabase CLI against SUPABASE_DB_URL from the repo-root .env.local.
// The connection string is read from the environment and passed straight to the
// CLI as an argument; it is never written to stdout or stderr by this script.
//
//   node scripts/db.mjs db push
//   node scripts/db.mjs db query "select 1"
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(file, repoRoot)));
  } catch {
    // Not present. Fall through to whatever the platform provides.
  }
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Fill it in in .env.local.');
  process.exit(1);
}

// The CLI's bin is a Node script. Run it with this Node, rather than the .bin
// shim, because Windows refuses to spawn a .CMD without a shell.
const cli = fileURLToPath(new URL('node_modules/supabase/dist/supabase.js', repoRoot));

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2), '--db-url', dbUrl], {
  stdio: 'inherit',
  cwd: fileURLToPath(repoRoot),
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
