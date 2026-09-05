import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Next only looks for env files inside apps/web, but the repo keeps one set at
// the root. Load those here, before compilation, so NEXT_PUBLIC_* still inlines.
// Neither file overrides a variable that is already set, so Vercel wins in production.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../${file}`, import.meta.url)));
  } catch {
    // Not present. Fall through to whatever the platform provides.
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sentrybot/core', '@sentrybot/ui'],
  // core's Node-only dependencies stay external to the server bundle.
  serverExternalPackages: ['unpdf', '@google/genai'],
  // Without this Next walks up past the repo and picks a stray lockfile as the root.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  eslint: {
    // `pnpm lint` at the repo root already runs the Next plugin rules over apps/web.
    // Next's own build-time pass is deprecated and cannot see the flat config up there.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
