import { NextResponse } from 'next/server';
import { searchNodes } from '@/server/repos/universe';
import { getAccountId } from '@/server/auth/session';
import { rateLimit } from '@/server/rate-limit';

export const dynamic = 'force-dynamic';

/** Typeahead for the Connect pickers. Session-gated; see src/lib/route-access.ts. */
export async function GET(request: Request): Promise<NextResponse> {
  // Middleware has already required a session; this reads the id to key the
  // budget by person rather than by address.
  const accountId = await getAccountId();
  if (!accountId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // A trigram search over every node in the graph, on every keystroke.
  const gate = await rateLimit(`nodes:${accountId}`, 30, 60);
  if (!gate.allowed) {
    return NextResponse.json(
      { results: [], throttled: true },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    );
  }

  const q = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json({ results: await searchNodes(q, 10) });
}
