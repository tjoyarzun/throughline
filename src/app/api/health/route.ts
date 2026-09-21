import { NextResponse } from 'next/server';
import { getHealth } from '@/server/repos/health';

/**
 * Public by design: it exposes no user data, and an uptime checker has to
 * reach it without credentials.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { status: 'error', db: 'not_configured', problems: ['DATABASE_URL is not set'] },
      { status: 503 },
    );
  }
  const report = await getHealth(url);
  return NextResponse.json(report, { status: report.status === 'ok' ? 200 : 503 });
}
