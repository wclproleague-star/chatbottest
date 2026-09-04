import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Local dev reads the repo-root .env; Railway supplies the environment itself.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file. Fall through to whatever the platform provides.
}

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.log('sentry bot: DISCORD_BOT_TOKEN is not set, so there is nothing to connect to yet.');
  console.log('sentry bot: scaffold booted. Gateway client is build order line 10.');
  process.exit(0);
}

console.log('sentry bot: scaffold booted with a token present.');
console.log('sentry bot: gateway client is build order line 10.');
