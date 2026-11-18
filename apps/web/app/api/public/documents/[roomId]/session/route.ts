import { NextRequest } from 'next/server';

import { handlePublicDocumentSession } from '../../../../../../lib/publicDocumentAccess/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  return handlePublicDocumentSession(request, await context.params);
}
