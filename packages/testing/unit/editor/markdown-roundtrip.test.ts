/** @vitest-environment jsdom */

import { parseMarkdownToDoc, serializeDocToMarkdown } from '@lash/editor-core';
import { describe, expect, it } from 'vitest';


const SAMPLE_MARKDOWN = `# Project Plan

Welcome to the **plan** with _style_ and ` + '`code`' + ` inline.

## Checklist
- [x] Setup repo
- [ ] Write docs

![Diagram](https://example.com/diagram.png)

| Phase | Owner |
| ----- | ----- |
| Alpha | Ava |
| Beta | Ben |
`;

describe('Markdown import/export', () => {
  it('round-trips supported structures', () => {
    const { doc, warnings } = parseMarkdownToDoc(SAMPLE_MARKDOWN, { documentId: 'unit-md' });

    expect(warnings).toEqual([]);
    expect(doc.type).toBe('doc');
    const hasTable = doc.content?.some((node) => node.type === 'table');
    expect(hasTable).toBe(true);

    const { markdown, warnings: exportWarnings } = serializeDocToMarkdown(doc, {
      documentId: 'unit-md',
    });

    expect(exportWarnings).toEqual([]);
    expect(markdown).toContain('# Project Plan');
    expect(markdown).toContain('- [x] Setup repo');
    expect(markdown).toContain('| Phase | Owner |');
    expect(markdown).toContain('[image-1]: https://example.com/diagram.png');
  });
});
