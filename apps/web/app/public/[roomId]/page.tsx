import type { Metadata } from 'next';
import * as React from 'react';

import styles from './page.module.css';
import { PublicDocumentClient } from './PublicDocumentClient';
import { parsePublicDocumentRoomId } from '../../../lib/publicDocumentAccess';

export const metadata: Metadata = {
  title: 'Opening public document · Lash',
  robots: {
    index: false,
    follow: false,
  },
};

type PublicDocumentPageProps = Readonly<{
  params: Promise<
    Readonly<{
      roomId: string;
    }>
  >;
}>;

export default async function PublicDocumentPage({ params }: PublicDocumentPageProps) {
  const roomId = parsePublicDocumentRoomId((await params).roomId);
  if (!roomId) {
    return (
      <main className={styles.shell} data-public-document-phase="unavailable">
        <p className={styles.statusCard} role="status">
          This document isn&apos;t available.
        </p>
      </main>
    );
  }

  return <PublicDocumentClient key={roomId} roomId={roomId} />;
}
