'use client';

import { useSearchParams } from 'next/navigation';

import { EditorWorkspaceLoader } from './EditorWorkspaceLoader';
import { readPreviewDocumentId } from '../../lib/documentNavigation';
import { DEFAULT_DOCUMENT_ID } from '../../lib/documentRegistry';

export function StaticEditorWorkspace() {
  const query = useSearchParams();
  const id = readPreviewDocumentId(query) ?? DEFAULT_DOCUMENT_ID;
  return <EditorWorkspaceLoader key={id} documentId={id} staticPreview />;
}
