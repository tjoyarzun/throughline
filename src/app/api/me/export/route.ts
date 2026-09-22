import { NextResponse } from 'next/server';
import { requireAccountId } from '@/server/auth/session';
import { exportAccount } from '@/server/repos/account';
import { titlesCsv } from '@/lib/export/csv';

export const dynamic = 'force-dynamic';

/**
 * Your data, as a file.
 *
 * A route handler rather than a server action because the point is a
 * DOWNLOAD: Content-Disposition is what makes the browser write a file
 * instead of rendering a wall of JSON, and an action cannot set it.
 *
 * Session-gated, and listed as such in src/lib/route-access.ts so that
 * "this route needs a session" is a recorded decision rather than an accident
 * of the middleware matcher.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const accountId = await requireAccountId();
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const data = await exportAccount(accountId);
  const stamp = new Date().toISOString().slice(0, 10);

  const body = format === 'csv' ? titlesCsv(data) : JSON.stringify(data, null, 2);

  return new NextResponse(body, {
    headers: {
      'Content-Type':
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="throughline-${stamp}.${format}"`,
      // Never let a CDN or a shared proxy hold a copy of someone's history.
      'Cache-Control': 'private, no-store',
    },
  }) as NextResponse;
}
