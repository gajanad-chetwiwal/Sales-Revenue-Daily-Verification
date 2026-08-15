import { NextResponse } from 'next/server';

// TEMPORARY diagnostic — Edge twin of /api/diag. Presence only, never values.
// Distinguishes "sensitive vars absent at runtime" from "Next inlined
// process.env into the Edge bundle at build time".
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    runtime: 'edge',
    vercelEnv: process.env.VERCEL_ENV ?? null,
    present: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      DASHBOARD_PASSWORD: Boolean(process.env.DASHBOARD_PASSWORD),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      TOKEN_ENCRYPTION_KEY: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
      DIAG_PLAIN: Boolean(process.env.DIAG_PLAIN),
    },
    totalEnvKeys: Object.keys(process.env).length,
  });
}
