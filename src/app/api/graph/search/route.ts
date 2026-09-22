import { NextResponse } from 'next/server';
import { searchNodes } from '@/server/repos/universe';

export const dynamic = 'force-dynamic';

/** Typeahead for the Connect pickers. Session-gated; see src/lib/route-access.ts. */
export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json({ results: await searchNodes(q, 10) });
}
