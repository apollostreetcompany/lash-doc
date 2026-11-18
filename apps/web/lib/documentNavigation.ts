import { documentPath, normalizeDocumentId } from './documentRegistry';

export const documentWorkspacePath = (documentId: string, staticPreview = false): string =>
  staticPreview ? `/?doc=${normalizeDocumentId(documentId)}` : documentPath(documentId);

export const readPreviewDocumentId = (query: Pick<URLSearchParams, 'getAll'>): string | null => {
  const [id, duplicate] = query.getAll('doc');
  return id && duplicate === undefined && id === normalizeDocumentId(id) ? id : null;
};

export const matchPreviewDocumentUrl = (text: string, origin: string) => {
  const href = text.trim();
  try {
    const url = new URL(href, origin);
    const id = readPreviewDocumentId(url.searchParams);
    if (!id) return null;
    const previewPath = documentWorkspacePath(id, true);
    if (href !== previewPath && href !== `${origin}${previewPath}`) return null;
    return { href: documentPath(id), refId: id };
  } catch {
    return null;
  }
};
