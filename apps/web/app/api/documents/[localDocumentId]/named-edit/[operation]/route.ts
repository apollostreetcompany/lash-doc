import type { NextRequest } from 'next/server';

import { handleNamedEdit } from '../../../../../../lib/namedEdit/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string; operation: string }> },
) {
  const { localDocumentId, operation } = await context.params;
  return handleNamedEdit(request, localDocumentId, operation);
}
