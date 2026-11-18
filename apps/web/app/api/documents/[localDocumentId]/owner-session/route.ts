import { NextRequest } from 'next/server';

import { handleDocumentOwnerSession } from '../../../../../lib/documentOwnerSession/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string }> },
) {
  return handleDocumentOwnerSession(request, await context.params);
}
