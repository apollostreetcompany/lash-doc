import { NextRequest } from 'next/server';

import { handlePublicCommentAuthoringSession } from '../../../../../../../lib/publicDocumentComments/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  return handlePublicCommentAuthoringSession(request, await context.params);
}
