import { describe, expect, it } from 'vitest';

import PublicDocumentPage, { metadata } from '../../../../apps/web/app/public/[roomId]/page';
import { renderToStaticMarkup } from '../../../../apps/web/node_modules/react-dom/server';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;

describe('public document shell', () => {
  it('is excluded from indexing and link following', () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('renders only the neutral authorization surface for a canonical room', async () => {
    const markup = renderToStaticMarkup(
      await PublicDocumentPage({
        params: Promise.resolve({ roomId: ROOM_ID }),
      }),
    );

    expect(markup).toContain('Opening public document…');
    expect(markup).toContain('data-public-document-phase="authorizing"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain(ROOM_ID);
    expect(markup).not.toContain('Can edit');
    expect(markup).not.toContain('contenteditable');
    expect(markup).not.toContain('document-title');
    expect(markup).not.toContain('document-body');
  });

  it('renders the same generic unavailable surface for malformed room locators', async () => {
    const markup = renderToStaticMarkup(
      await PublicDocumentPage({
        params: Promise.resolve({ roomId: `doc-v1-${'a'.repeat(63)}_` }),
      }),
    );

    expect(markup).toContain('This document isn&#x27;t available.');
    expect(markup).toContain('data-public-document-phase="unavailable"');
    expect(markup).not.toContain('Can edit');
    expect(markup).not.toContain('contenteditable');
  });
});
