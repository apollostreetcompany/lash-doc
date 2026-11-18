import { NextRequest } from 'next/server';

import { handleDocumentPromotion } from '../../../../../lib/documentPromotion/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string }> },
) {
  return handleDocumentPromotion(request, await context.params);
}
