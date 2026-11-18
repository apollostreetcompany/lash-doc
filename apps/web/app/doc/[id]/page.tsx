import { EditorWorkspaceLoader } from '../../../components/editor/EditorWorkspaceLoader';
import { normalizeDocumentId } from '../../../lib/documentRegistry';

interface DocumentPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;
  const documentId = normalizeDocumentId(id);

  return (
    <main data-testid="lash-document-page" role="main" aria-labelledby="lash-page-title">
      <h1 className="sr-only" id="lash-page-title">
        Lash Collaborative Editor
      </h1>
      <section aria-label="Document workspace">
        <EditorWorkspaceLoader key={documentId} documentId={documentId} />
      </section>
    </main>
  );
}
