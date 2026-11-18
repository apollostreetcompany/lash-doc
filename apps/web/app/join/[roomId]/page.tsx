import type { Metadata } from 'next';
import * as React from 'react';

import { NamedMemberJoinClient } from './NamedMemberJoinClient';
import { isNamedMemberJoinReturnPath } from '../../../lib/auth/returnUrl';

export const metadata: Metadata = {
  title: 'Document invitation · Lash',
  robots: { index: false, follow: false },
  referrer: 'origin',
};

export default async function NamedMemberJoinPage({
  params,
}: Readonly<{ params: Promise<{ roomId: string }> }>) {
  const { roomId } = await params;
  const canonicalRoomId = isNamedMemberJoinReturnPath(`/join/${roomId}`) ? roomId : null;

  return <NamedMemberJoinClient key={canonicalRoomId} roomId={canonicalRoomId} />;
}
