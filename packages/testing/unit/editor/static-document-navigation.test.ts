import { describe, expect, it } from 'vitest';

import {
  documentWorkspacePath,
  matchPreviewDocumentUrl,
  readPreviewDocumentId,
} from '../../../../apps/web/lib/documentNavigation';

describe('static preview document addresses', () => {
  it('keeps the server route and static preview query separate', () => {
    expect(documentWorkspacePath('Draft 17')).toBe('/doc/draft-17');
    expect(documentWorkspacePath('Draft 17', true)).toBe('/?doc=draft-17');
    expect(readPreviewDocumentId(new URLSearchParams('doc=draft-17'))).toBe('draft-17');
    expect(readPreviewDocumentId(new URLSearchParams('doc=draft-17&doc=other'))).toBeNull();
    expect(readPreviewDocumentId(new URLSearchParams('doc=../other'))).toBeNull();
  });

  it('converts only exact same-site preview URLs to portable stored document references', () => {
    const origin = 'https://preview.example';
    const expected = { refId: 'draft-17', href: '/doc/draft-17' };
    expect(matchPreviewDocumentUrl('/?doc=draft-17', origin)).toEqual(expected);
    expect(matchPreviewDocumentUrl(`${origin}/?doc=draft-17`, origin)).toEqual(expected);
    expect(matchPreviewDocumentUrl(`${origin}.test/?doc=draft-17`, origin)).toBeNull();
    expect(matchPreviewDocumentUrl('/?doc=draft-17&token=private', origin)).toBeNull();
    expect(matchPreviewDocumentUrl('/other?doc=draft-17', origin)).toBeNull();
  });
});
