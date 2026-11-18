import { NextRequest } from 'next/server';

import { handlePublicCommentList } from '../../../../../../../lib/publicDocumentComments/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  return handlePublicCommentList(request, await context.params);
}
