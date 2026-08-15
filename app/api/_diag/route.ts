import { NextResponse } from 'next/server';

// TEMPORARY diagnostic — reports only whether a variable is present, never its
// value. Removed once the env-injection issue is resolved.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WATCHED = [
  'DATABASE_URL',
  'DASHBOARD_PASSWORD',
  'CRON_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'DIAG_PLAIN',
] as const;

export function GET(): NextResponse {
  const present: Record<string, boolean> = {};
  for (const key of WATCHED) {
    present[key] = Boolean(process.env[key]);
  }

  return NextResponse.json({
    runtime: 'nodejs',
    vercelEnv: process.env.VERCEL_ENV ?? null,
    present,
    totalEnvKeys: Object.keys(process.env).length,
    // Names only — confirms process.env is populated at all.
    vercelKeyNames: Object.keys(process.env)
      .filter((k) => k.startsWith('VERCEL_'))
      .sort(),
  });
}
