import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project; an unrelated lockfile higher up the
  // tree would otherwise be picked as the workspace root.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  typescript: {
    // Never ship a build that does not type-check.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
