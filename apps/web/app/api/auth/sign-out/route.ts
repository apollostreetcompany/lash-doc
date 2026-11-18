import { NextRequest } from 'next/server';

import { handleSignOut } from '../../../../lib/auth/routeHandlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleSignOut(request);
}
