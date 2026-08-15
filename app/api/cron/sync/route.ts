import { NextResponse } from 'next/server';

import { constantTimeEquals } from '@/lib/password';
import { runSync } from '@/lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduled sync entry point (see vercel.json).
 *
 * Guarded by CRON_SECRET rather than the dashboard session — middleware skips
 * /api/cron/* precisely so this check is the only gate. Vercel Cron sends the
 * Bearer header automatically once CRON_SECRET is set on the project.
 */
async function handle(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!constantTimeEquals(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Leave ~15s of the 60s budget for writing sync state and responding.
    const result = await runSync({ deadlineMs: 45_000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message.slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
