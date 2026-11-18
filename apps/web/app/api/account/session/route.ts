import { NextRequest } from 'next/server';

import { handleAccountSession } from '../../../../lib/auth/routeHandlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleAccountSession(request);
}
