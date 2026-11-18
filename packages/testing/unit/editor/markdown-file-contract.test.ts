/** @vitest-environment jsdom */

import {
  deriveLegacyMarkdownTitle,
  MARKDOWN_FILE_MAX_BYTES,
  parseMarkdownFileToDoc,
  parseMarkdownToDoc,
  serializeDocToMarkdown,
  serializeDocToMarkdownFile,
  type MarkdownFileParseResult,
} from '@lash/editor-core';
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

const MARKER = '<!-- lash-markdown:v1 -->';

const STR_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Launch plan' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship on ' },
        { type: 'text', text: 'Tuesday', marks: [{ type: 'bold' }] },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewer' }] }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Share' }] }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Reference brief',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
  ],
};

const expectParseError = (
  result: MarkdownFileParseResult,
  code: Extract<MarkdownFileParseResult, { ok: false }>['code'],
) => {
  expect(result).toMatchObject({ ok: false, code });
};

type TableCellKind = 'tableHeader' | 'tableCell';

const tableDocument = (
  rows: Array<
    Array<{
      kind: TableCellKind;
      text: string;
      block?: 'heading' | 'paragraph';
    }>
  >,
): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      content: rows.map((row) => ({
        type: 'tableRow',
        content: row.map(({ kind, text, block = 'paragraph' }) => ({
          type: kind,
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [
            block === 'heading'
              ? {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text }],
                }
              : { type: 'paragraph', content: [{ type: 'text', text }] },
          ],
        })),
      })),
    },
  ],
});

const tableSnapshot = (doc: JSONContent) =>
  doc.content?.[0]?.content?.map((row) =>
    row.content?.map((cell) => ({
      kind: cell.type,
      block: cell.content?.[0]?.type,
      text: cell.content?.[0]?.content?.map((node) => node.text ?? '').join('') ?? '',
    })),
  );

describe('Lash Markdown v1 file contract', () => {
  it('emits the normative UTF-8/LF golden bytes and parses them losslessly', () => {
    const first = serializeDocToMarkdownFile(STR_DOCUMENT, {
      title: 'Project kickoff — P01',
      documentId: 'project-kickoff',
    });
    const second = serializeDocToMarkdownFile(STR_DOCUMENT, {
      title: 'Project kickoff — P01',
      documentId: 'project-kickoff',
    });

    const expected = `${MARKER}\n\n# Project kickoff — P01\n\n## Launch plan\n\nShip on **Tuesday**.\n\n- Owner\n- Reviewer\n\n* [x] Draft\n* [ ] Share\n\n[Reference brief](https://example.com)\n`;
    expect(first).toEqual({
      markdown: expected,
      normalizedTitle: 'Project kickoff — P01',
      filename: 'project-kickoff-p01.md',
      warnings: [],
      blockedReasons: [],
    });
    expect(second).toEqual(first);
    expect(new TextEncoder().encode(first.markdown)[0]).not.toBe(0xef);
    expect(first.markdown).not.toContain('\r');
    expect(first.markdown).toMatch(/[^\n]\n$/u);

    const parsed = parseMarkdownFileToDoc(first.markdown);
    expect(parsed).toEqual({
      ok: true,
      format: 'lash-v1',
      title: 'Project kickoff — P01',
      doc: STR_DOCUMENT,
      warnings: [],
    });
  });

  it('uses the marker to remove only the synthetic title when the body starts with H1', () => {
    const bodyWithH1: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Body heading' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    };
    const exported = serializeDocToMarkdownFile(bodyWithH1, { title: 'File title' });

    expect(exported.markdown).toBe(`${MARKER}\n\n# File title\n\n# Body heading\n\nBody text\n`);
    expect(parseMarkdownFileToDoc(exported.markdown)).toEqual({
      ok: true,
      format: 'lash-v1',
      title: 'File title',
      doc: bodyWithH1,
      warnings: [],
    });
  });

  it('round-trips visible marker text without confusing text or code for a structural marker', () => {
    const visibleMarkerDoc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: MARKER }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: MARKER, marks: [{ type: 'code' }] }],
        },
      ],
    };
    const exported = serializeDocToMarkdownFile(visibleMarkerDoc, { title: 'Marker text' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.markdown).toContain(`\\${MARKER}`);
    expect(exported.markdown).toContain(`\`${MARKER}\``);
    expect(parseMarkdownFileToDoc(exported.markdown)).toEqual({
      ok: true,
      format: 'lash-v1',
      title: 'Marker text',
      doc: visibleMarkerDoc,
      warnings: [],
    });

    expect(
      parseMarkdownFileToDoc(`${MARKER}\n\n# Fenced marker\n\n\`\`\`text\n${MARKER}\n\`\`\`\n`),
    ).toMatchObject({
      ok: true,
      format: 'lash-v1',
      title: 'Fenced marker',
      doc: {
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: MARKER }],
          },
        ],
      },
    });
  });

  it.each([`> ${MARKER}\n`, `- ${MARKER}\n`])(
    'rejects a structural duplicate marker nested below the Markdown root: %s',
    (body) => {
      expectParseError(
        parseMarkdownFileToDoc(`${MARKER}\n\n# Nested duplicate\n\n${body}`),
        'malformed-lash-v1',
      );
    },
  );

  it('accepts one optional BOM and CRLF without emitting either on re-export', () => {
    const imported = parseMarkdownFileToDoc(
      `\ufeff${MARKER}\r\n\r\n# Portable title\r\n\r\n# Body H1\r\n`,
    );
    expect(imported).toMatchObject({
      ok: true,
      format: 'lash-v1',
      title: 'Portable title',
      doc: {
        content: [{ type: 'heading', attrs: { level: 1 } }],
      },
    });
    if (!imported.ok) throw new Error('expected marked import');
    const exported = serializeDocToMarkdownFile(imported.doc, { title: imported.title ?? '' });
    expect(exported.markdown.startsWith(MARKER)).toBe(true);
    expect(exported.markdown).not.toContain('\ufeff');
    expect(exported.markdown).not.toContain('\r');
  });

  it('normalizes titles strictly and derives deterministic safe filenames', () => {
    expect(
      serializeDocToMarkdownFile(STR_DOCUMENT, {
        title: '  Cafe\u0301\r\nlaunch\u0000  ',
      }),
    ).toMatchObject({
      normalizedTitle: 'Café  launch',
      filename: 'cafe-launch.md',
    });
    expect(serializeDocToMarkdownFile(STR_DOCUMENT, { title: '' })).toMatchObject({
      normalizedTitle: 'Untitled document',
      filename: 'untitled-document.md',
    });
    expect(serializeDocToMarkdownFile(STR_DOCUMENT, { title: 'CON' }).filename).toBe('lash-con.md');
    expect(
      serializeDocToMarkdownFile(STR_DOCUMENT, {
        title: '日本語',
        documentId: '  My Unsafe_ID!  ',
      }).filename,
    ).toBe('lash-my-unsafe-id.md');
    expect(serializeDocToMarkdownFile(STR_DOCUMENT, { title: '日本語' }).filename).toBe(
      'lash-document.md',
    );
    expect(
      serializeDocToMarkdownFile(STR_DOCUMENT, { title: `${'a'.repeat(79)} z` }).filename,
    ).toBe(`${'a'.repeat(79)}.md`);
  });

  it('repairs unpaired surrogates, preserves Unicode/bidi, and keeps title syntax as data', () => {
    const title = '\ud800 # * [label] --> שלום';
    const exported = serializeDocToMarkdownFile(STR_DOCUMENT, { title });
    expect(exported.normalizedTitle).toBe('� # * [label] --> שלום');
    expect(exported.markdown.match(/lash-markdown:/gu)).toHaveLength(1);

    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({
      ok: true,
      format: 'lash-v1',
      title: exported.normalizedTitle,
    });

    const manuallyEdited = parseMarkdownFileToDoc(`${MARKER}\n\n# Cafe\u0301\u0001\n`);
    expect(manuallyEdited).toMatchObject({
      ok: true,
      title: 'Café',
      warnings: ['Document title was normalized for safe Markdown import.'],
    });
  });

  it('blocks over-limit titles without truncating and rejects over-limit input before parsing', () => {
    const overLimitTitle = '🙂'.repeat(1_025);
    const exported = serializeDocToMarkdownFile(STR_DOCUMENT, { title: overLimitTitle });
    expect(new TextEncoder().encode(exported.normalizedTitle)).toHaveLength(4_100);
    expect(exported.markdown).toBe('');
    expect(exported.blockedReasons).toEqual([
      'Document title exceeds the 4,096-byte Markdown file limit.',
    ]);

    const overLimitFile = '🙂'.repeat(500_001);
    expect(new TextEncoder().encode(overLimitFile).byteLength).toBeGreaterThan(2_000_000);
    expectParseError(parseMarkdownFileToDoc(overLimitFile), 'file-too-large');

    expectParseError(
      parseMarkdownFileToDoc(`${MARKER}\n\n# ${overLimitTitle}\n`),
      'malformed-lash-v1',
    );
  });

  it('exports one authoritative byte limit and accepts its exact boundary only', () => {
    expect(MARKDOWN_FILE_MAX_BYTES).toBe(2_000_000);

    const exactBoundary = 'a'.repeat(MARKDOWN_FILE_MAX_BYTES);
    expect(new TextEncoder().encode(exactBoundary)).toHaveLength(MARKDOWN_FILE_MAX_BYTES);
    expect(parseMarkdownFileToDoc(exactBoundary)).toMatchObject({
      ok: true,
      format: 'legacy',
    });

    expectParseError(parseMarkdownFileToDoc(`${exactBoundary}a`), 'file-too-large');
  });

  it('preserves all legacy body headings and does not infer title authority from content', () => {
    const legacy = parseMarkdownFileToDoc('# Project Plan\n\n# Second body heading\n');
    expect(legacy).toMatchObject({
      ok: true,
      format: 'legacy',
      title: null,
      doc: {
        content: [
          { type: 'heading', attrs: { level: 1 } },
          { type: 'heading', attrs: { level: 1 } },
        ],
      },
      warnings: [],
    });

    const foreign = parseMarkdownFileToDoc(
      '---\ntitle: Override\nid: stolen\n---\n\n# Body title\n',
    );
    expect(foreign).toMatchObject({ ok: true, format: 'legacy', title: null });
    if (!foreign.ok) throw new Error('expected legacy import');
    expect(foreign.doc.content?.some((node) => node.type === 'heading')).toBe(true);
    expect(foreign.warnings).toContain('Horizontal rules are not supported and were removed.');
  });

  it('returns strictly JSON-safe documents for representative legacy Markdown', () => {
    const parsed = parseMarkdownFileToDoc(`# Heading with ![](https://example.com/heading.png)

Plain text with **bold text**.

- Bullet item

1. Ordered item

* [x] Task item

![](https://example.com/body.png)
`);

    expect(parsed).toMatchObject({ ok: true, format: 'legacy' });
    if (!parsed.ok) throw new Error('expected representative legacy import');
    expect(parsed.doc).toStrictEqual(JSON.parse(JSON.stringify(parsed.doc)));

    const textNodes: JSONContent[] = [];
    const visit = (node: JSONContent) => {
      if (node.type === 'text') textNodes.push(node);
      node.content?.forEach(visit);
    };
    visit(parsed.doc);
    expect(textNodes.some((node) => node.text === 'Plain text with ' && !('marks' in node))).toBe(
      true,
    );
    expect(
      parsed.doc.content
        ?.filter((node) => node.type === 'bulletList' || node.type === 'taskList')
        .every((node) => !('attrs' in node)),
    ).toBe(true);
  });

  it('derives legacy titles only from the basename using the shared normalization contract', () => {
    expect(deriveLegacyMarkdownTitle('Project Cafe\u0301.markdown')).toBe('Project Café');
    expect(deriveLegacyMarkdownTitle('notes.md.backup')).toBe('notes.md.backup');
    expect(deriveLegacyMarkdownTitle('  unsafe\r\nname.MD  ')).toBe('unsafe  name');
    expect(deriveLegacyMarkdownTitle('.md')).toBe('Imported document');
    expect(deriveLegacyMarkdownTitle('日本語.markdown')).toBe('日本語');
  });

  it.each([
    [`${MARKER}\n# Missing blank line\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n## Wrong level\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n# **Formatted**\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n# [Linked](https://example.com)\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n# <span>HTML</span>\n`, 'malformed-lash-v1'],
    [`${MARKER}\n\n# Title\n\n${MARKER}\n`, 'malformed-lash-v1'],
  ] as const)('rejects malformed marked input without legacy fallback', (markdown, code) => {
    expectParseError(parseMarkdownFileToDoc(markdown), code);
  });

  it('rejects unknown byte-zero Lash versions but treats a later marker as legacy HTML', () => {
    expectParseError(
      parseMarkdownFileToDoc('<!-- lash-markdown:v2 -->\n\n# Future title\n'),
      'unsupported-lash-version',
    );

    const misplaced = parseMarkdownFileToDoc(`Body first\n\n${MARKER}\n\n# Still body\n`);
    expect(misplaced).toMatchObject({ ok: true, format: 'legacy', title: null });
    if (!misplaced.ok) throw new Error('expected legacy import');
    expect(misplaced.warnings).toContain('HTML blocks are stripped during Markdown import.');
    expect(misplaced.doc.content?.some((node) => node.type === 'heading')).toBe(true);
  });

  it.each(['[unsafe](javascript:alert(1))', '![unsafe](data:text/html;base64,PHNjcmlwdD4=)'])(
    'fails closed for unsafe Markdown URL content: %s',
    (markdown) => {
      expectParseError(parseMarkdownFileToDoc(markdown), 'unsafe-content');
    },
  );

  it('strips executable raw HTML with deterministic warnings and no executable residue', () => {
    const parsed = parseMarkdownFileToDoc(
      '<script>alert("no")</script>\n\n<img src=x onerror=alert(1)>\n\nSafe text\n',
    );
    expect(parsed).toMatchObject({ ok: true, format: 'legacy', title: null });
    if (!parsed.ok) throw new Error('expected sanitized import');
    expect(JSON.stringify(parsed.doc)).not.toContain('alert');
    expect(parsed.warnings).toEqual(['HTML blocks are stripped during Markdown import.']);
  });

  it('preserves safe reference-link labels and URLs as exact link marks', () => {
    const parsed = parseMarkdownFileToDoc(
      '[Reference brief][brief]\n\n[brief]: https://example.com/reference\n',
    );
    expect(parsed).toMatchObject({ ok: true, format: 'legacy', warnings: [] });
    if (!parsed.ok) throw new Error('expected safe reference-link import');
    expect(parsed.doc.content?.[0]?.content?.[0]).toEqual({
      type: 'text',
      text: 'Reference brief',
      marks: [{ type: 'link', attrs: { href: 'https://example.com/reference' } }],
    });
  });

  it('fails closed for unsafe or missing reference-link definitions', () => {
    expectParseError(
      parseMarkdownFileToDoc('[Unsafe reference][unsafe]\n\n[unsafe]: javascript:alert(1)\n'),
      'unsafe-content',
    );
    expectParseError(parseMarkdownFileToDoc('[Missing reference][missing]\n'), 'schema-invalid');
  });

  it('does not mistake escaped or code-literal brackets for unresolved references', () => {
    const parsed = parseMarkdownFileToDoc(
      '`[Inline literal][missing]`\n\n```text\n[Fenced literal][missing]\n```\n\n\\[Escaped][missing]\n',
    );
    expect(parsed).toMatchObject({ ok: true, format: 'legacy' });
  });

  it('rejects deeply nested input as schema-invalid instead of overflowing conversion', () => {
    expectParseError(parseMarkdownFileToDoc(`${'> '.repeat(70)}deep\n`), 'schema-invalid');
  });

  it('round-trips the canonical table header layout with exact cell kinds', () => {
    const canonical = tableDocument([
      [
        { kind: 'tableHeader', text: 'Phase' },
        { kind: 'tableHeader', text: 'Owner' },
      ],
      [
        { kind: 'tableCell', text: 'Alpha' },
        { kind: 'tableCell', text: 'Ava' },
      ],
    ]);
    const exported = serializeDocToMarkdownFile(canonical, { title: 'Canonical table' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.warnings).toEqual([]);
    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({ ok: true, format: 'lash-v1' });
    if (!parsed.ok) throw new Error('expected canonical table import');
    expect(parsed.doc).toEqual(canonical);
  });

  it('warns before promoting an ordinary first table row to Markdown headers', () => {
    const noHeader = tableDocument([
      [{ kind: 'tableCell', text: 'A' }],
      [{ kind: 'tableCell', text: 'B' }],
    ]);
    const exported = serializeDocToMarkdownFile(noHeader, { title: 'No header table' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.warnings).toEqual([
      'First-row table cells are promoted to headers in Markdown.',
    ]);
    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({ ok: true, format: 'lash-v1' });
    if (!parsed.ok) throw new Error('expected no-header table import');
    expect(tableSnapshot(parsed.doc)).toEqual([
      [{ kind: 'tableHeader', block: 'paragraph', text: 'A' }],
      [{ kind: 'tableCell', block: 'paragraph', text: 'B' }],
    ]);
  });

  it('warns for both promotions and demotions in a header-column table', () => {
    const headerColumn = tableDocument([
      [
        { kind: 'tableHeader', text: 'Header A' },
        { kind: 'tableCell', text: 'Value A' },
      ],
      [
        { kind: 'tableHeader', text: 'Header B' },
        { kind: 'tableCell', text: 'Value B' },
      ],
    ]);
    const exported = serializeDocToMarkdownFile(headerColumn, { title: 'Header column table' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.warnings).toEqual([
      'First-row table cells are promoted to headers in Markdown.',
      'Table headers after the first row are demoted to ordinary cells in Markdown.',
    ]);
    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({ ok: true, format: 'lash-v1' });
    if (!parsed.ok) throw new Error('expected header-column table import');
    expect(tableSnapshot(parsed.doc)).toEqual([
      [
        { kind: 'tableHeader', block: 'paragraph', text: 'Header A' },
        { kind: 'tableHeader', block: 'paragraph', text: 'Value A' },
      ],
      [
        { kind: 'tableCell', block: 'paragraph', text: 'Header B' },
        { kind: 'tableCell', block: 'paragraph', text: 'Value B' },
      ],
    ]);
  });

  it('warns before normalizing a mixed first header row', () => {
    const mixedHeaderRow = tableDocument([
      [
        { kind: 'tableHeader', text: 'Header' },
        { kind: 'tableCell', text: 'Value' },
      ],
      [
        { kind: 'tableCell', text: 'Alpha' },
        { kind: 'tableCell', text: 'Ava' },
      ],
    ]);
    const exported = serializeDocToMarkdownFile(mixedHeaderRow, { title: 'Mixed header row' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.warnings).toEqual([
      'First-row table cells are promoted to headers in Markdown.',
    ]);
    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({ ok: true, format: 'lash-v1' });
    if (!parsed.ok) throw new Error('expected mixed-header table import');
    expect(tableSnapshot(parsed.doc)).toEqual([
      [
        { kind: 'tableHeader', block: 'paragraph', text: 'Header' },
        { kind: 'tableHeader', block: 'paragraph', text: 'Value' },
      ],
      [
        { kind: 'tableCell', block: 'paragraph', text: 'Alpha' },
        { kind: 'tableCell', block: 'paragraph', text: 'Ava' },
      ],
    ]);
  });

  it.each([
    {
      name: 'duplicate bold marks',
      marks: [{ type: 'bold' }, { type: 'bold' }],
      blockedReason: 'Document text contains duplicate “bold” marks.',
    },
    {
      name: 'bold combined with code',
      marks: [{ type: 'bold' }, { type: 'code' }],
      blockedReason: 'Inline code cannot be combined with other marks for Markdown export.',
    },
    {
      name: 'link combined with code',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'code' }],
      blockedReason: 'Inline code cannot be combined with other marks for Markdown export.',
    },
  ])('blocks active-schema-invalid mark collections: $name', ({ marks, blockedReason }) => {
    const result = serializeDocToMarkdownFile(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Marked', marks }] }],
      },
      { title: 'Invalid marks' },
    );

    expect(result.markdown).toBe('');
    expect(result.blockedReasons).toEqual([blockedReason]);
  });

  it('preserves unique safe mark combinations', () => {
    const result = serializeDocToMarkdownFile(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Bold italic link',
                marks: [
                  { type: 'bold' },
                  { type: 'italic' },
                  { type: 'link', attrs: { href: 'https://example.com' } },
                ],
              },
              { type: 'text', text: ' and ' },
              {
                type: 'text',
                text: 'underlined link',
                marks: [
                  { type: 'underline' },
                  { type: 'link', attrs: { href: 'https://example.com/underline' } },
                ],
              },
            ],
          },
        ],
      },
      { title: 'Safe marks' },
    );

    expect(result.blockedReasons).toEqual([]);
    expect(result.warnings).toEqual(['Underline formatting is exported as emphasis in Markdown.']);
    expect(result.markdown).toContain('Bold italic link');
    expect(result.markdown).toContain('underlined link');
  });

  it('flattens a schema-valid heading in a table cell with an explicit warning', () => {
    const headingCell = tableDocument([
      [{ kind: 'tableHeader', text: 'Heading label', block: 'heading' }],
      [{ kind: 'tableCell', text: 'Body value' }],
    ]);
    const exported = serializeDocToMarkdownFile(headingCell, { title: 'Heading cell' });

    expect(exported.blockedReasons).toEqual([]);
    expect(exported.warnings).toEqual(['Table-cell block formatting is exported as plain text.']);
    const parsed = parseMarkdownFileToDoc(exported.markdown);
    expect(parsed).toMatchObject({ ok: true, format: 'lash-v1' });
    if (!parsed.ok) throw new Error('expected heading-cell table import');
    expect(tableSnapshot(parsed.doc)).toEqual([
      [{ kind: 'tableHeader', block: 'paragraph', text: 'Heading label' }],
      [{ kind: 'tableCell', block: 'paragraph', text: 'Body value' }],
    ]);
  });

  it('does not broadly accept unsupported blocks directly inside table cells', () => {
    const result = serializeDocToMarkdownFile(
      {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    content: [{ type: 'opaqueWidget', attrs: { display: 'Unproven block' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { title: 'Unsupported cell block' },
    );

    expect(result.markdown).toBe('');
    expect(result.blockedReasons).toEqual([
      'Unsupported node “opaqueWidget” is not valid inside “tableCell” content.',
      'Document node “tableHeader” must contain a paragraph.',
    ]);
  });

  it('warns deterministically for every simplification while preserving visible labels', () => {
    const lossyDoc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Underlined', marks: [{ type: 'underline' }] },
            { type: 'text', text: ' Suggested', marks: [{ type: 'suggestInsert' }] },
            { type: 'mention', attrs: { display: 'Ava' } },
          ],
        },
        {
          type: 'image',
          attrs: { src: 'https://example.com/image.png', alt: 'Diagram', width: 480 },
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: {
                    colspan: 2,
                    rowspan: 1,
                    colwidth: [120],
                    cellType: 'status',
                    value: 'Approved',
                    options: ['Draft', 'Approved'],
                  },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Review' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const first = serializeDocToMarkdownFile(lossyDoc, { title: 'Warnings' });
    const second = serializeDocToMarkdownFile(lossyDoc, { title: 'Warnings' });
    expect(first).toEqual(second);
    expect(first.blockedReasons).toEqual([]);
    expect(first.warnings).toEqual([
      'Unsupported mark “suggestInsert” was exported as plain text.',
      'Unsupported inline node “mention” was exported as plain text.',
      'Image sizing is omitted from Markdown.',
      'Merged table-cell spans are flattened in Markdown.',
      'Table-cell column widths are omitted from Markdown.',
      'Status/select table-cell semantics are exported as plain text.',
      'Table cells with multiple blocks were flattened into a single line because Markdown tables cannot represent multi-block cells.',
      'First-row table cells are promoted to headers in Markdown.',
      'Underline formatting is exported as emphasis in Markdown.',
    ]);
    expect(first.markdown).toContain('@Ava');
    expect(first.markdown).toContain('Review');
    expect(first.markdown).toContain('Owner');
    expect(first.markdown).toContain('Approved');
    expect(first.markdown).toContain('[image-1]: https://example.com/image.png');
  });

  it('blocks export when an unsupported node has no preservable visible text', () => {
    const result = serializeDocToMarkdownFile(
      { type: 'doc', content: [{ type: 'opaqueWidget', attrs: { secret: 'not-visible' } }] },
      { title: 'Blocked' },
    );
    expect(result.markdown).toBe('');
    expect(result.blockedReasons).toEqual([
      'Unsupported node “opaqueWidget” has no preservable visible text.',
    ]);
  });

  it.each([
    {
      name: 'a block node nested in inline paragraph content',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'MUST SURVIVE' }],
              },
            ],
          },
        ],
      } satisfies JSONContent,
    },
    {
      name: 'a task item nested in an ordinary bullet list',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Checked' }] }],
              },
            ],
          },
        ],
      } satisfies JSONContent,
    },
    {
      name: 'an ordinary list item nested in a task list',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordinary' }] }],
              },
            ],
          },
        ],
      } satisfies JSONContent,
    },
  ])('blocks invalid known-node placement: $name', ({ doc }) => {
    const result = serializeDocToMarkdownFile(doc, { title: 'Invalid placement' });

    expect(result.markdown).toBe('');
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  it('blocks self-referential unsupported nodes without throwing', () => {
    const cyclicNode: JSONContent = {
      type: 'opaqueWidget',
      attrs: { display: 'Cycle' },
      content: [],
    };
    cyclicNode.content = [cyclicNode];
    const results: ReturnType<typeof serializeDocToMarkdownFile>[] = [];

    expect(() => {
      results.push(
        serializeDocToMarkdownFile({ type: 'doc', content: [cyclicNode] }, { title: 'Cycle' }),
      );
    }).not.toThrow();
    expect(results[0]).toMatchObject({
      markdown: '',
      blockedReasons: ['Document contains a reused or cyclic node structure.'],
    });
  });

  it('blocks a 20,000-deep unsupported-node chain without overflowing the stack', () => {
    let deepNode: JSONContent = { type: 'text', text: 'Buried label' };
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepNode = { type: 'opaqueWidget', content: [deepNode] };
    }
    const results: ReturnType<typeof serializeDocToMarkdownFile>[] = [];

    expect(() => {
      results.push(
        serializeDocToMarkdownFile({ type: 'doc', content: [deepNode] }, { title: 'Deep' }),
      );
    }).not.toThrow();
    expect(results[0]).toMatchObject({
      markdown: '',
      blockedReasons: ['Document structure exceeds safe Markdown export bounds.'],
    });
  });

  it('preserves every reachable unsupported-node label within export bounds', () => {
    const result = serializeDocToMarkdownFile(
      {
        type: 'doc',
        content: [
          {
            type: 'opaqueWidget',
            attrs: { display: 'Root ' },
            content: [
              { type: 'text', text: 'First ' },
              { type: 'mention', attrs: { display: 'Ava' } },
              { type: 'nestedWidget', attrs: { label: ' Tail' } },
            ],
          },
        ],
      },
      { title: 'Labels' },
    );

    expect(result.blockedReasons).toEqual([]);
    expect(result.markdown).toContain('Root First @Ava Tail');
  });

  it('returns a typed blocked result when runtime document access throws', () => {
    const throwingDocument = new Proxy({} as JSONContent, {
      get() {
        throw new Error('hostile getter');
      },
    });
    const results: ReturnType<typeof serializeDocToMarkdownFile>[] = [];

    expect(() => {
      results.push(serializeDocToMarkdownFile(throwingDocument, { title: 'Hostile' }));
    }).not.toThrow();
    expect(results[0]).toEqual({
      markdown: '',
      normalizedTitle: 'Hostile',
      filename: 'hostile.md',
      warnings: [],
      blockedReasons: ['Document content could not be processed safely.'],
    });
  });

  it('rejects unsafe export URLs and structurally invalid documents', () => {
    const unsafe = serializeDocToMarkdownFile(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'unsafe',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
      { title: 'Unsafe' },
    );
    expect(unsafe.markdown).toBe('');
    expect(unsafe.blockedReasons).toEqual(['Link uses an unsafe URL.']);

    const invalid = serializeDocToMarkdownFile(
      { type: 'paragraph', content: [{ type: 'text', text: 'not a doc' }] },
      { title: 'Invalid' },
    );
    expect(invalid.markdown).toBe('');
    expect(invalid.blockedReasons).toEqual(['Markdown export requires a valid document root.']);
  });

  it('keeps the body-only APIs source-compatible and marker-free', () => {
    const bodyMarkdown = '# Existing body API\n';
    const parsed = parseMarkdownToDoc(bodyMarkdown, { documentId: 'ignored-but-compatible' });
    const serialized = serializeDocToMarkdown(parsed.doc, {
      documentId: 'ignored-but-compatible',
    });

    expect(parsed.warnings).toEqual([]);
    expect(serialized.warnings).toEqual([]);
    expect(serialized.markdown).toBe(bodyMarkdown);
    expect(serialized.markdown).not.toContain('lash-markdown');
  });
});
