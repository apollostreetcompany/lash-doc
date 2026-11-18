import { NextRequest } from 'next/server';

import { handleDocumentPublicAccess } from '../../../../../../lib/documentPublicAccess/routeHandler';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string }> },
) {
  return handleDocumentPublicAccess(request, await context.params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string }> },
) {
  return handleDocumentPublicAccess(request, await context.params);
}
