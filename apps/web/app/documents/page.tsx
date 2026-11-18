import type { Metadata } from 'next';

import { DocumentsWorkspace } from './DocumentsWorkspace';

export const metadata: Metadata = { title: 'Documents — Lash' };

export default function DocumentsPage() {
  return <DocumentsWorkspace />;
}
