import { NextRequest } from 'next/server';

import { handlePublicCommentCreate } from '../../../../../../../lib/publicDocumentComments/routeHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  return handlePublicCommentCreate(request, await context.params);
}
