import dynamic from 'next/dynamic';

import { normalizeDocumentId } from '../../../lib/documentRegistry';

const EditorWorkspace = dynamic(() => import('../../../components/editor/EditorWorkspace'), {
  ssr: false,
});

interface DocumentPageProps {
  params: {
    id: string;
  };
}

export default function DocumentPage({ params }: DocumentPageProps) {
  const documentId = normalizeDocumentId(params.id);

  return (
    <main data-testid="lash-document-page" role="main" aria-labelledby="lash-page-title">
      <h1 className="sr-only" id="lash-page-title">
        Lash Collaborative Editor
      </h1>
      <section aria-label="Document editor">
        <EditorWorkspace key={documentId} documentId={documentId} />
      </section>
    </main>
  );
}
