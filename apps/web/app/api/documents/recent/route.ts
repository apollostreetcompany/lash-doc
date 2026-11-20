import type { NextRequest } from 'next/server';

import { handleRecentNamedDocuments } from '../../../../lib/namedEdit/recentRouteHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleRecentNamedDocuments(request);
}
