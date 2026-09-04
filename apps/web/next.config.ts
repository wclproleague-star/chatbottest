import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sentrybot/core', '@sentrybot/ui'],
  // Without this Next walks up past the repo and picks a stray lockfile as the root.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  eslint: {
    // `pnpm lint` at the repo root already runs the Next plugin rules over apps/web.
    // Next's own build-time pass is deprecated and cannot see the flat config up there.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
