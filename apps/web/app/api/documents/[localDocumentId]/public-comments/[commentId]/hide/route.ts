import { NextRequest } from 'next/server';

import { handlePublicCommentHide } from '../../../../../../../lib/publicDocumentComments/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ localDocumentId: string; commentId: string }> },
) {
  return handlePublicCommentHide(request, await context.params);
}
