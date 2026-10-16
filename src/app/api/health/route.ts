import { NextResponse } from 'next/server';
import { getHealth } from '@/server/repos/health';

/**
 * Public, and says only ok or not. The full report -- auth configuration,
 * queue, cron, corpus -- is /api/admin/health, behind CRON_SECRET.
 *
 * It used to return the full report to anyone, which told strangers how
 * sign-in is configured (least_privilege flipping to false would be public
 * before it was noticed), and opened a fresh database connection per hit
 * with nothing in front of it: a loop against this URL kept Neon awake.
 *
 * s-maxage=30 lets Vercel's CDN answer repeats, so strangers cost at most one
 * report per region per 30 seconds. The status is still computed from the full
 * report -- health, not liveness -- just not shown.
 */
export const dynamic = 'force-dynamic';

const PUBLIC_CACHE = { 'Cache-Control': 'public, s-maxage=30' };

export async function GET(): Promise<NextResponse> {
  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ status: 'error' }, { status: 503 });
  const { status } = await getHealth(url);
  return NextResponse.json(
    { status },
    { status: status === 'ok' ? 200 : 503, headers: PUBLIC_CACHE },
  );
}
