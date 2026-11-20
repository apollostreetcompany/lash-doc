import type { JSONContent } from '@tiptap/core';
import type {
  Content,
  Definition,
  BlockContent,
  Heading,
  Image,
  ImageReference,
  LinkReference,
  List,
  ListItem,
  Paragraph,
  Root,
  Table,
  TableCell,
  TableRow,
  PhrasingContent,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import type { Options as RemarkStringifyOptions } from 'remark-stringify';
import { unified } from 'unified';

import { safeChipHref } from '../extensions/chip';
import { isEmbeddedRasterImage } from '../extensions/image-source';
import { visibleMentionLabel } from '../schema/mentions';
import { sanitizeCellType } from '../table/types';
import { resolveOptions } from '../table/utils';

export interface MarkdownImportResult {
  doc: JSONContent;
  warnings: string[];
}

export interface MarkdownImportOptions {
  documentId?: string;
}

export type MarkdownFileFormat = 'lash-v1' | 'legacy';

export type MarkdownFileParseResult =
  | {
      ok: true;
      format: MarkdownFileFormat;
      title: string | null;
      doc: JSONContent;
      warnings: string[];
    }
  | {
      ok: false;
      code:
        | 'file-too-large'
        | 'unsupported-lash-version'
        | 'malformed-lash-v1'
        | 'unsafe-content'
        | 'schema-invalid';
      message: string;
    };

export interface MarkdownFileSerializeOptions {
  title: string;
  documentId?: string;
  mode?: 'share-copy';
}

export interface MarkdownFileSerializeResult {
  markdown: string;
  normalizedTitle: string;
  filename: string;
  warnings: string[];
  blockedReasons: string[];
}

const LASH_MARKDOWN_V1_MARKER = '<!-- lash-markdown:v1 -->';
const LASH_MARKDOWN_NAMESPACE_PREFIX = '<!-- lash-markdown:';
export const MARKDOWN_FILE_MAX_BYTES = 2_000_000;
const MAX_MARKDOWN_TITLE_BYTES = 4_096;
const MAX_MARKDOWN_STRUCTURE_DEPTH = 64;
const MAX_MARKDOWN_STRUCTURE_VALUES = 200_000;

const clampHeadingLevel = (depth: number): 1 | 2 | 3 => {
  if (depth <= 1) {
    return 1;
  }
  if (depth === 2) {
    return 2;
  }
  return 3;
};

const ensureParagraph = (content: JSONContent[] | undefined): JSONContent[] => {
  const inner = content && content.length ? content : [];
  return [
    {
      type: 'paragraph',
      content: inner.length ? inner : [{ type: 'text', text: '' }],
    },
  ];
};

type JSONMark = { type: string; attrs?: Record<string, unknown> };

const convertInlineNode = (
  node: PhrasingContent,
  marks: JSONMark[],
  warnings: Set<string>,
  definitions: Map<string, Definition>,
  allowImages: boolean,
): JSONContent[] => {
  switch (node.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: node.value ?? '',
          ...(marks.length ? { marks } : {}),
        },
      ];
    case 'break':
      return [{ type: 'hardBreak' }];
    case 'strong':
      return node.children.flatMap((child) =>
        convertInlineNode(child, [...marks, { type: 'bold' }], warnings, definitions, allowImages),
      );
    case 'emphasis':
      return node.children.flatMap((child) =>
        convertInlineNode(
          child,
          [...marks, { type: 'italic' }],
          warnings,
          definitions,
          allowImages,
        ),
      );
    case 'inlineCode':
      return [
        {
          type: 'text',
          text: node.value ?? '',
          marks: [...marks, { type: 'code' }],
        },
      ];
    case 'link': {
      const href = node.url ?? '';
      return node.children.flatMap((child) =>
        convertInlineNode(
          child,
          [...marks, { type: 'link', attrs: { href } }],
          warnings,
          definitions,
          allowImages,
        ),
      );
    }
    case 'linkReference': {
      const reference = node as LinkReference;
      const definition = definitions.get(reference.identifier);
      if (!definition) {
        warnings.add(`Missing link definition for reference “${reference.identifier}”.`);
        return reference.children.flatMap((child) =>
          convertInlineNode(child, marks, warnings, definitions, allowImages),
        );
      }
      return reference.children.flatMap((child) =>
        convertInlineNode(
          child,
          [...marks, { type: 'link', attrs: { href: definition.url ?? '' } }],
          warnings,
          definitions,
          allowImages,
        ),
      );
    }
    case 'delete': {
      warnings.add('Strikethrough formatting is not supported and was imported as plain text.');
      return node.children.flatMap((child) =>
        convertInlineNode(child, marks, warnings, definitions, allowImages),
      );
    }
    case 'image':
    case 'imageReference':
      if (!allowImages) {
        warnings.add('Images inside headings were converted to alt text.');
        const fallbackText =
          node.type === 'image'
            ? (node.alt ?? '')
            : (node.alt ?? definitions.get(node.identifier)?.title ?? '');
        return [
          {
            type: 'text',
            text: fallbackText,
            ...(marks.length ? { marks } : {}),
          },
        ];
      }
      return convertImageInline(node, warnings, definitions);
    case 'html':
      warnings.add('HTML snippets are stripped during Markdown import.');
      return [];
    default:
      warnings.add(`Unsupported inline node “${node.type}” was converted to plain text.`);
      if ('value' in node && typeof node.value === 'string') {
        return [
          {
            type: 'text',
            text: node.value,
            ...(marks.length ? { marks } : {}),
          },
        ];
      }
      return [];
  }
};

const convertInlineChildren = (
  children: PhrasingContent[] | undefined,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
  allowImages: boolean,
): JSONContent[] => {
  if (!children) {
    return [];
  }
  return children.flatMap((child) =>
    convertInlineNode(child, [], warnings, definitions, allowImages),
  );
};

const convertImageInline = (
  node: Image | ImageReference,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
): JSONContent[] => {
  const attrs = getImageAttributes(node, definitions, warnings);
  if (!attrs) {
    return [];
  }
  return [
    {
      type: 'image',
      attrs,
    },
  ];
};

const getImageAttributes = (
  node: Image | ImageReference,
  definitions: Map<string, Definition>,
  warnings: Set<string>,
): { src: string; alt?: string } | null => {
  if (node.type === 'image') {
    return {
      src: node.url ?? '',
      ...(node.alt === null || node.alt === undefined ? {} : { alt: node.alt }),
    };
  }
  const definition = definitions.get(node.identifier);
  if (!definition) {
    warnings.add(`Missing image definition for reference “${node.identifier}”.`);
    return null;
  }
  return {
    src: definition.url ?? '',
    ...(node.alt === null || node.alt === undefined ? {} : { alt: node.alt }),
  };
};

const convertListItem = (
  item: ListItem,
  isTask: boolean,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
): JSONContent => {
  const children: JSONContent[] = [];
  item.children.forEach((child) => {
    children.push(...convertBlock(child as Content, warnings, definitions));
  });

  if (!children.length) {
    children.push({ type: 'paragraph', content: [{ type: 'text', text: '' }] });
  }

  if (isTask) {
    return {
      type: 'taskItem',
      attrs: { checked: Boolean(item.checked) },
      content: children,
    };
  }

  return {
    type: 'listItem',
    content: children,
  };
};

const convertTable = (
  table: Table,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
): JSONContent => {
  const rows = table.children as TableRow[];
  const content = rows.map((row, rowIndex) => {
    const cells = row.children as TableCell[];
    const cellContent = cells.map((cell) => {
      const inline = convertInlineChildren(
        cell.children as PhrasingContent[],
        warnings,
        definitions,
        true,
      );
      return {
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: ensureParagraph(inline),
      };
    });
    return {
      type: 'tableRow',
      content: cellContent,
    };
  });

  return {
    type: 'table',
    content,
  };
};

const convertParagraphNode = (
  node: Paragraph,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
): JSONContent[] => {
  const blocks: JSONContent[] = [];
  let inlineBuffer: JSONContent[] = [];

  node.children.forEach((child) => {
    if (child.type === 'image' || child.type === 'imageReference') {
      if (inlineBuffer.length) {
        blocks.push({ type: 'paragraph', content: inlineBuffer });
        inlineBuffer = [];
      }
      blocks.push(...convertImageInline(child, warnings, definitions));
    } else {
      inlineBuffer.push(...convertInlineNode(child, [], warnings, definitions, true));
    }
  });

  if (inlineBuffer.length || !blocks.length) {
    blocks.push({ type: 'paragraph', content: inlineBuffer });
  }

  return blocks;
};

const convertBlock = (
  node: Content,
  warnings: Set<string>,
  definitions: Map<string, Definition>,
): JSONContent[] => {
  switch (node.type) {
    case 'heading': {
      const heading = node as Heading;
      const content = convertInlineChildren(
        heading.children as PhrasingContent[],
        warnings,
        definitions,
        false,
      );
      return [
        {
          type: 'heading',
          attrs: { level: clampHeadingLevel(heading.depth) },
          content,
        },
      ];
    }
    case 'paragraph':
      return convertParagraphNode(node as Paragraph, warnings, definitions);
    case 'list': {
      const list = node as List;
      const isTask = list.children.some(
        (child) =>
          child.type === 'listItem' && child.checked !== null && child.checked !== undefined,
      );
      const items = list.children.map((child) =>
        convertListItem(child as ListItem, isTask, warnings, definitions),
      );
      return [
        {
          type: isTask ? 'taskList' : list.ordered ? 'orderedList' : 'bulletList',
          ...(list.ordered ? { attrs: { start: list.start ?? 1 } } : {}),
          content: items,
        },
      ];
    }
    case 'table':
      return [convertTable(node as Table, warnings, definitions)];
    case 'code':
      warnings.add('Code blocks are imported as plain paragraphs.');
      return [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: (node.value ?? '').trim() }],
        },
      ];
    case 'blockquote':
      warnings.add('Blockquotes are flattened into paragraphs.');
      return (node.children as Content[]).flatMap((child) =>
        convertBlock(child, warnings, definitions),
      );
    case 'thematicBreak':
      warnings.add('Horizontal rules are not supported and were removed.');
      return [];
    case 'html':
      warnings.add('HTML blocks are stripped during Markdown import.');
      return [];
    default:
      warnings.add(`Unsupported node “${node.type}” was imported as plain text.`);
      if ('value' in node && typeof node.value === 'string') {
        return [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: node.value }],
          },
        ];
      }
      return [];
  }
};

export const parseMarkdownToDoc = (
  markdown: string,
  _options?: MarkdownImportOptions,
): MarkdownImportResult => {
  const warnings = new Set<string>();
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.parse(markdown || '');

  const definitions = new Map<string, Definition>();
  const filteredChildren: Content[] = [];
  (tree as Root).children.forEach((child) => {
    if (child.type === 'definition') {
      const def = child as Definition;
      definitions.set(def.identifier, def);
      return;
    }
    filteredChildren.push(child as Content);
  });

  const content = filteredChildren.flatMap((child) => convertBlock(child, warnings, definitions));

  const doc: JSONContent = {
    type: 'doc',
    content: content.length
      ? content
      : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  };

  return { doc, warnings: Array.from(warnings) };
};

interface ImageDefinition {
  id: string;
  src: string;
}

const applyMarks = (
  node: JSONContent,
  warnings: Set<string>,
  _definitions: Map<string, ImageDefinition>,
): PhrasingContent => {
  if (node.type === 'text') {
    const base: PhrasingContent = node.marks?.some((mark) => mark.type === 'code')
      ? { type: 'inlineCode', value: node.text ?? '' }
      : { type: 'text', value: node.text ?? '' };

    return node.marks
      ? node.marks.reduceRight<PhrasingContent>((acc, mark) => {
          switch (mark.type) {
            case 'bold':
              return { type: 'strong', children: [acc] };
            case 'italic':
              return { type: 'emphasis', children: [acc] };
            case 'link':
              return { type: 'link', url: mark.attrs?.href ?? '', children: [acc] };
            case 'underline':
              warnings.add('Underline formatting is exported as emphasis in Markdown.');
              return { type: 'emphasis', children: [acc] };
            case 'code':
              return acc;
            default:
              return acc;
          }
        }, base)
      : base;
  }

  if (node.type === 'hardBreak') {
    return { type: 'break' };
  }

  return { type: 'text', value: '' };
};

const convertParagraphToMdast = (
  node: JSONContent,
  warnings: Set<string>,
  definitions: Map<string, ImageDefinition>,
): Content[] => {
  if (!node.content) {
    return [];
  }

  const inlineChildren: PhrasingContent[] = [];
  node.content.forEach((child) => {
    if (child.type === 'image' && child.attrs?.src) {
      inlineChildren.push(convertImageToMdast(child, definitions));
    } else {
      inlineChildren.push(applyMarks(child, warnings, definitions));
    }
  });

  return [
    {
      type: 'paragraph',
      children: inlineChildren.length ? inlineChildren : [{ type: 'text', value: '' }],
    },
  ];
};

const convertImageToMdast = (
  node: JSONContent,
  definitions: Map<string, ImageDefinition>,
): PhrasingContent => {
  const src = node.attrs?.src ?? '';
  let definition = Array.from(definitions.values()).find((entry) => entry.src === src);
  if (!definition) {
    const id = `image-${definitions.size + 1}`;
    definition = { id, src };
    definitions.set(id, definition);
  }
  return {
    type: 'imageReference',
    identifier: definition.id,
    label: definition.id,
    referenceType: 'full',
    alt: node.attrs?.alt,
  };
};

const convertDocNodeToMdast = (
  node: JSONContent,
  warnings: Set<string>,
  definitions: Map<string, ImageDefinition>,
): Content[] => {
  switch (node.type) {
    case 'heading':
      return [
        {
          type: 'heading',
          depth:
            typeof node.attrs?.level === 'number'
              ? (Math.min(Math.max(node.attrs.level, 1), 3) as 1 | 2 | 3)
              : 1,
          children: convertInlineForExport(node.content ?? [], warnings, definitions),
        },
      ];
    case 'paragraph':
      return convertParagraphToMdast(node, warnings, definitions);
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return [convertListToMdast(node, warnings, definitions)];
    case 'image':
      if (!node.attrs?.src) {
        return [];
      }
      return [
        {
          type: 'paragraph',
          children: [convertImageToMdast(node, definitions)],
        },
      ];
    case 'table':
      return [convertTableToMdast(node, warnings, definitions)];
    default:
      if (node.type === 'text') {
        return [
          {
            type: 'paragraph',
            children: convertInlineForExport([node], warnings, definitions),
          },
        ];
      }
      warnings.add(`Unsupported node “${node.type}” was exported as plain text.`);
      return [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '' }],
        },
      ];
  }
};

const convertInlineForExport = (
  content: JSONContent[],
  warnings: Set<string>,
  definitions: Map<string, ImageDefinition>,
): PhrasingContent[] => {
  return content.flatMap((child) => {
    if (child.type === 'image') {
      if (!child.attrs?.src) {
        return [];
      }
      return [convertImageToMdast(child, definitions)];
    }
    return [applyMarks(child, warnings, definitions)];
  });
};

const convertListToMdast = (
  node: JSONContent,
  warnings: Set<string>,
  definitions: Map<string, ImageDefinition>,
): List => {
  const ordered = node.type === 'orderedList';
  const isTask = node.type === 'taskList';
  const children = (node.content ?? []).map((item) => {
    const listItem: ListItem = {
      type: 'listItem',
      spread: false,
      checked: isTask ? Boolean(item.attrs?.checked) : undefined,
      children: [] as BlockContent[],
    };

    (item.content ?? []).forEach((childNode) => {
      listItem.children.push(
        ...(convertDocNodeToMdast(childNode, warnings, definitions) as unknown as BlockContent[]),
      );
    });

    if (!listItem.children.length) {
      listItem.children.push({ type: 'paragraph', children: [{ type: 'text', value: '' }] });
    }

    return listItem;
  });

  return {
    type: 'list',
    ordered,
    start: ordered && typeof node.attrs?.start === 'number' ? node.attrs.start : undefined,
    spread: false,
    children,
  };
};

const convertTableToMdast = (
  node: JSONContent,
  warnings: Set<string>,
  definitions: Map<string, ImageDefinition>,
): Table => {
  const rows: TableRow[] = (node.content ?? []).map((row) => {
    const cells: TableCell[] = (row.content ?? []).map((cell) => {
      const blocks = (cell.content as JSONContent[] | undefined) ?? [];
      if (blocks.length > 1) {
        warnings.add(
          'Table cells with multiple blocks were flattened into a single line because Markdown tables cannot represent multi-block cells.',
        );
      }
      const cellContent = blocks.flatMap((block, blockIndex) => {
        const inline = convertInlineForExport(
          (block.content as JSONContent[] | undefined) ?? [],
          warnings,
          definitions,
        );
        // mdast tableCell children must remain inline (PhrasingContent), so
        // separate concatenated blocks with a hard break instead of nesting
        // block nodes; this keeps later blocks from running into the prior one.
        return blockIndex > 0 && inline.length
          ? [{ type: 'break' } as PhrasingContent, ...inline]
          : inline;
      });
      return {
        type: 'tableCell',
        children: cellContent.length ? cellContent : [{ type: 'text', value: '' }],
      } as TableCell;
    });
    return {
      type: 'tableRow',
      children: cells,
    } as TableRow;
  });

  const columnCount = rows[0]?.children.length ?? 0;
  return {
    type: 'table',
    align: Array(columnCount).fill(null),
    children: rows,
  };
};

export const serializeDocToMarkdown = (
  doc: JSONContent,
  _options?: MarkdownImportOptions,
): { markdown: string; warnings: string[] } => {
  const warnings = new Set<string>();
  const definitions = new Map<string, ImageDefinition>();

  const root: Root = {
    type: 'root',
    children: [],
  };

  (doc.content ?? []).forEach((node) => {
    root.children.push(...convertDocNodeToMdast(node, warnings, definitions));
  });

  definitions.forEach((definition) => {
    root.children.push({
      type: 'definition',
      identifier: definition.id,
      label: definition.id,
      url: definition.src,
    });
  });

  const stringifyOptions: RemarkStringifyOptions = {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
  };

  const processor = unified().use(remarkGfm).use(remarkStringify, stringifyOptions);

  const markdown = processor.stringify(root);
  return { markdown, warnings: Array.from(warnings) };
};

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const replaceUnpairedSurrogates = (value: string) => {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index] + value[index + 1];
        index += 1;
      } else {
        normalized += '\ufffd';
      }
      continue;
    }
    normalized += current >= 0xdc00 && current <= 0xdfff ? '\ufffd' : value[index];
  }
  return normalized;
};

const normalizeMarkdownTitle = (title: string, fallback: string) => {
  const normalized = replaceUnpairedSurrogates(title)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, ' ')
    .trim();
  return normalized || fallback;
};

export const deriveLegacyMarkdownTitle = (filename: string): string => {
  const basename = replaceUnpairedSurrogates(filename).trim().split(/[\\/]/u).at(-1) ?? '';
  const withoutExtension = basename.replace(/\.(?:md|markdown)$/iu, '');
  return normalizeMarkdownTitle(withoutExtension, 'Imported document');
};

const normalizeDocumentIdForFilename = (documentId: string | undefined) =>
  (documentId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 96)
    .replace(/-+$/gu, '');

const filenameForTitle = (title: string, documentId: string | undefined) => {
  let slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '');

  if (!slug) {
    const normalizedDocumentId = normalizeDocumentIdForFilename(documentId);
    slug = normalizedDocumentId ? `lash-${normalizedDocumentId}` : 'lash-document';
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(slug)) {
    slug = `lash-${slug}`;
  }
  return `${slug}.md`;
};

type MarkdownAstNode = {
  type: string;
  children?: MarkdownAstNode[];
  value?: unknown;
  url?: unknown;
  identifier?: unknown;
  alt?: unknown;
};

type MarkdownDefinitionMap = Map<string, { url: string }>;

const normalizeReferenceIdentifier = (identifier: string) =>
  identifier.trim().replace(/\s+/gu, ' ').toLowerCase();

const isSafeMarkdownUrl = (value: string, kind: 'image' | 'link') => {
  if (!value) return true;
  const normalized = value.trim();
  try {
    const protocol = new URL(normalized, 'https://lash.local').protocol.toLowerCase();
    return kind === 'image'
      ? protocol === 'https:' ||
          protocol === 'http:' ||
          (protocol === 'data:' && isEmbeddedRasterImage(normalized))
      : protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
};

const htmlHasPreservableVisibleText = (html: string) => {
  const withoutHiddenContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, '');
  return withoutHiddenContent.replace(/<[^>]*>/gu, '').trim().length > 0;
};

const collectDefinitions = (tree: MarkdownAstNode): MarkdownDefinitionMap => {
  const definitions: MarkdownDefinitionMap = new Map();
  const visit = (node: MarkdownAstNode) => {
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      typeof node.url === 'string'
    ) {
      definitions.set(normalizeReferenceIdentifier(node.identifier), { url: node.url });
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return definitions;
};

const hasMissingExplicitReferenceDefinition = (
  markdown: string,
  definitions: MarkdownDefinitionMap,
) => {
  let fence: '`' | '~' | null = null;
  const visibleLines = markdown.split('\n').map((line) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return '';
    }
    if (fence !== null) return '';
    return line.replace(/(`+)(?:[^`]|`(?!\1))*\1/gu, '').replace(/\\./gu, '');
  });
  const referencePattern = /!?\[([^\]\n]+)\]\[([^\]\n]*)\]/gu;
  for (const line of visibleLines) {
    for (const match of line.matchAll(referencePattern)) {
      const identifier = normalizeReferenceIdentifier(match[2] || match[1]);
      if (!definitions.has(identifier)) return true;
    }
  }
  return false;
};

const KNOWN_MARKDOWN_AST_NODES = new Set([
  'root',
  'definition',
  'text',
  'break',
  'strong',
  'emphasis',
  'inlineCode',
  'link',
  'linkReference',
  'delete',
  'image',
  'imageReference',
  'heading',
  'paragraph',
  'list',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'code',
  'blockquote',
  'thematicBreak',
  'html',
]);

const validateMarkdownAst = (
  tree: MarkdownAstNode,
): { code: 'unsafe-content' | 'schema-invalid'; message: string } | null => {
  const definitions = collectDefinitions(tree);
  let valueCount = 0;
  let failure: { code: 'unsafe-content' | 'schema-invalid'; message: string } | null = null;

  const fail = (code: 'unsafe-content' | 'schema-invalid', message: string) => {
    failure ??= { code, message };
  };

  const visit = (node: MarkdownAstNode, depth: number) => {
    if (failure) return;
    valueCount += 1;
    if (valueCount > MAX_MARKDOWN_STRUCTURE_VALUES || depth > MAX_MARKDOWN_STRUCTURE_DEPTH) {
      fail('schema-invalid', 'Markdown structure exceeds safe document bounds.');
      return;
    }
    if (!KNOWN_MARKDOWN_AST_NODES.has(node.type)) {
      const visible =
        typeof node.value === 'string' || Boolean(node.children?.length)
          ? 'potentially visible'
          : '';
      if (visible) {
        fail('schema-invalid', `Markdown node “${node.type}” cannot be preserved safely.`);
        return;
      }
    }
    if (node.type === 'html' && typeof node.value === 'string') {
      if (htmlHasPreservableVisibleText(node.value)) {
        fail('unsafe-content', 'Raw HTML with visible text cannot be preserved safely.');
        return;
      }
    }
    if (
      node.type === 'code' &&
      typeof node.value === 'string' &&
      node.value.trim() !== node.value
    ) {
      fail('unsafe-content', 'Code-block boundary whitespace cannot be preserved safely.');
      return;
    }
    if ((node.type === 'link' || node.type === 'image') && typeof node.url === 'string') {
      const kind = node.type === 'image' ? 'image' : 'link';
      if (!isSafeMarkdownUrl(node.url, kind)) {
        fail('unsafe-content', `Markdown ${kind} uses an unsafe URL.`);
        return;
      }
    }
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const definition =
        typeof node.identifier === 'string'
          ? definitions.get(normalizeReferenceIdentifier(node.identifier))
          : undefined;
      if (!definition) {
        fail('schema-invalid', `Markdown reference “${String(node.identifier ?? '')}” is missing.`);
        return;
      }
      const kind = node.type === 'imageReference' ? 'image' : 'link';
      if (!isSafeMarkdownUrl(definition.url, kind)) {
        fail('unsafe-content', `Markdown ${kind} reference uses an unsafe URL.`);
        return;
      }
    }
    node.children?.forEach((child) => visit(child, depth + 1));
  };

  visit(tree, 0);
  return failure;
};

const validateGeneratedDocument = (doc: JSONContent) => {
  let count = 0;
  let valid = true;
  const visit = (node: JSONContent, depth: number) => {
    if (!valid) return;
    count += 1;
    if (
      count > MAX_MARKDOWN_STRUCTURE_VALUES ||
      depth > MAX_MARKDOWN_STRUCTURE_DEPTH ||
      !node ||
      typeof node !== 'object' ||
      typeof node.type !== 'string' ||
      (node.content !== undefined && !Array.isArray(node.content))
    ) {
      valid = false;
      return;
    }
    node.content?.forEach((child) => visit(child, depth + 1));
  };
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return false;
  visit(doc, 0);
  return valid;
};

const parseFileBody = (
  markdown: string,
):
  | { ok: true; doc: JSONContent; warnings: string[] }
  | { ok: false; code: 'unsafe-content' | 'schema-invalid'; message: string } => {
  try {
    const processor = unified().use(remarkParse).use(remarkGfm);
    const tree = processor.parse(markdown) as unknown as MarkdownAstNode;
    const validationFailure = validateMarkdownAst(tree);
    if (validationFailure) return { ok: false, ...validationFailure };
    if (hasMissingExplicitReferenceDefinition(markdown, collectDefinitions(tree))) {
      return {
        ok: false,
        code: 'schema-invalid',
        message: 'Markdown contains a reference link without a definition.',
      };
    }
    const parsed = parseMarkdownToDoc(markdown);
    if (!validateGeneratedDocument(parsed.doc)) {
      return {
        ok: false,
        code: 'schema-invalid',
        message: 'Markdown did not produce a valid Lash document.',
      };
    }
    return { ok: true, ...parsed };
  } catch {
    return {
      ok: false,
      code: 'schema-invalid',
      message: 'Markdown could not be parsed into a valid Lash document.',
    };
  }
};

const parseFailure = (
  code: Extract<MarkdownFileParseResult, { ok: false }>['code'],
  message: string,
): MarkdownFileParseResult => ({ ok: false, code, message });

const scanStructuralLashMarker = (markdown: string): 'clear' | 'found' | 'structure-too-large' => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const stack: Array<{ node: MarkdownAstNode; depth: number }> = [
    { node: tree as unknown as MarkdownAstNode, depth: 0 },
  ];
  let valueCount = 0;

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    valueCount += 1;
    if (
      valueCount > MAX_MARKDOWN_STRUCTURE_VALUES ||
      current.depth > MAX_MARKDOWN_STRUCTURE_DEPTH
    ) {
      return 'structure-too-large';
    }
    if (
      current.node.type === 'html' &&
      typeof current.node.value === 'string' &&
      current.node.value.trim() === LASH_MARKDOWN_V1_MARKER
    ) {
      return 'found';
    }
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }

  return 'clear';
};

/**
 * Pure file preflight. This enforces the format's own size, structure, and URL
 * boundaries without touching editor or persistence state. The application
 * must additionally validate a successful `doc` against its active TipTap
 * schema and local-body persistence bounds before enabling import confirmation.
 */
export const parseMarkdownFileToDoc = (markdown: string): MarkdownFileParseResult => {
  try {
    if (utf8ByteLength(markdown) > MARKDOWN_FILE_MAX_BYTES) {
      return parseFailure('file-too-large', 'Markdown file exceeds the 2,000,000-byte limit.');
    }
    const withoutBom = markdown.startsWith('\ufeff') ? markdown.slice(1) : markdown;
    if (withoutBom.startsWith('\ufeff')) {
      return parseFailure(
        'schema-invalid',
        'Markdown file contains more than one byte-order mark.',
      );
    }
    const normalized = withoutBom.replace(/\r\n/gu, '\n');
    const claimsLashNamespace = normalized.startsWith(LASH_MARKDOWN_NAMESPACE_PREFIX);

    if (!claimsLashNamespace) {
      const parsed = parseFileBody(normalized);
      return parsed.ok
        ? { ok: true, format: 'legacy', title: null, doc: parsed.doc, warnings: parsed.warnings }
        : parsed;
    }

    const firstLineEnd = normalized.indexOf('\n');
    const firstLine = firstLineEnd === -1 ? normalized : normalized.slice(0, firstLineEnd);
    if (firstLine !== LASH_MARKDOWN_V1_MARKER) {
      const version = /^<!-- lash-markdown:([^ ]+) -->$/u.exec(firstLine)?.[1];
      return version && version !== 'v1'
        ? parseFailure(
            'unsupported-lash-version',
            `Lash Markdown version “${version}” is not supported.`,
          )
        : parseFailure('malformed-lash-v1', 'Lash Markdown v1 marker is malformed.');
    }

    const filePrefix = `${LASH_MARKDOWN_V1_MARKER}\n\n`;
    if (!normalized.startsWith(filePrefix)) {
      return parseFailure(
        'malformed-lash-v1',
        'Lash Markdown v1 requires one blank line after its marker.',
      );
    }

    const afterMarker = normalized.slice(filePrefix.length);
    const titleLineEnd = afterMarker.indexOf('\n');
    const titleLine = titleLineEnd === -1 ? afterMarker : afterMarker.slice(0, titleLineEnd);
    const titleTree = unified().use(remarkParse).use(remarkGfm).parse(`${titleLine}\n`) as Root;
    const titleHeading = titleTree.children[0];
    if (
      titleTree.children.length !== 1 ||
      titleHeading?.type !== 'heading' ||
      titleHeading.depth !== 1 ||
      titleHeading.children.length === 0 ||
      !titleHeading.children.every((child) => child.type === 'text')
    ) {
      return parseFailure(
        'malformed-lash-v1',
        'Lash Markdown v1 requires one plain-text level-one title heading.',
      );
    }

    const rawTitle = titleHeading.children.map((child) => child.value).join('');
    const normalizedTitle = normalizeMarkdownTitle(rawTitle, '');
    if (!normalizedTitle || utf8ByteLength(normalizedTitle) > MAX_MARKDOWN_TITLE_BYTES) {
      return parseFailure('malformed-lash-v1', 'Lash Markdown v1 title is empty or too large.');
    }

    let bodyMarkdown = '';
    if (titleLineEnd !== -1) {
      const afterTitle = afterMarker.slice(titleLineEnd);
      if (afterTitle !== '\n') {
        if (!afterTitle.startsWith('\n\n') || afterTitle.startsWith('\n\n\n')) {
          return parseFailure(
            'malformed-lash-v1',
            'Lash Markdown v1 requires one blank line after its title.',
          );
        }
        bodyMarkdown = afterTitle.slice(2);
      }
    }
    const structuralMarkerScan = scanStructuralLashMarker(bodyMarkdown);
    if (structuralMarkerScan === 'structure-too-large') {
      return parseFailure('schema-invalid', 'Markdown structure exceeds safe document bounds.');
    }
    if (structuralMarkerScan === 'found') {
      return parseFailure('malformed-lash-v1', 'Lash Markdown v1 contains a duplicate marker.');
    }

    const parsed = parseFileBody(bodyMarkdown);
    return parsed.ok
      ? {
          ok: true,
          format: 'lash-v1',
          title: normalizedTitle,
          doc: parsed.doc,
          warnings: [
            ...(rawTitle === normalizedTitle
              ? []
              : ['Document title was normalized for safe Markdown import.']),
            ...parsed.warnings,
          ],
        }
      : parsed;
  } catch {
    return parseFailure('schema-invalid', 'Markdown file could not be parsed safely.');
  }
};

type FileExportPreflight = {
  shareCopy: boolean;
  warnings: Set<string>;
  blockedReasons: Set<string>;
  visited: WeakSet<object>;
  valueCount: number;
};

const visibleLabelsForNode = (node: JSONContent): string[] => {
  if (node.type === 'mention' && node.attrs) {
    const label = visibleMentionLabel(node.attrs);
    return label ? [label] : [];
  }
  if (node.type === 'chip') {
    const href = safeChipHref(node.attrs?.href);
    return href ? [href] : [];
  }
  if (typeof node.text === 'string') return node.text ? [node.text] : [];

  const labels: string[] = [];
  for (const attribute of ['display', 'label', 'title', 'name']) {
    const value = node.attrs?.[attribute];
    if (typeof value === 'string' && value && !labels.includes(value)) labels.push(value);
  }
  return labels;
};

const visibleTextForSanitizedNodes = (nodes: JSONContent[]): string => {
  const parts: string[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    parts.push(...visibleLabelsForNode(node));
    if (Array.isArray(node.content)) {
      for (let index = node.content.length - 1; index >= 0; index -= 1) {
        stack.push(node.content[index]);
      }
    }
  }
  return parts.join('');
};

const visibleTextForUnsupportedNode = (
  root: JSONContent,
  preflight: FileExportPreflight,
  rootDepth: number,
): string => {
  const parts: string[] = [];
  const stack: Array<{ node: JSONContent; depth: number; isRoot: boolean }> = [
    { node: root, depth: rootDepth, isRoot: true },
  ];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const { node, depth, isRoot } = current;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      preflight.blockedReasons.add('Document contains an invalid node.');
      continue;
    }
    if (!isRoot) {
      if (preflight.visited.has(node)) {
        preflight.blockedReasons.add('Document contains a reused or cyclic node structure.');
        continue;
      }
      preflight.visited.add(node);
      preflight.valueCount += 1;
      if (
        preflight.valueCount > MAX_MARKDOWN_STRUCTURE_VALUES ||
        depth > MAX_MARKDOWN_STRUCTURE_DEPTH
      ) {
        preflight.blockedReasons.add('Document structure exceeds safe Markdown export bounds.');
        continue;
      }
      if (typeof node.type !== 'string') {
        preflight.blockedReasons.add('Document contains a node without a valid type.');
        continue;
      }
    }

    parts.push(...visibleLabelsForNode(node));
    if (node.content === undefined) continue;
    if (!Array.isArray(node.content)) {
      preflight.blockedReasons.add(`Document node “${node.type}” has invalid content.`);
      continue;
    }
    for (let index = node.content.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.content[index], depth: depth + 1, isRoot: false });
    }
  }

  return parts.join('');
};

const sanitizeMarksForFile = (
  marks: JSONContent['marks'],
  preflight: FileExportPreflight,
): JSONContent['marks'] => {
  if (marks === undefined) return undefined;
  if (!Array.isArray(marks)) {
    preflight.blockedReasons.add('Document text contains an invalid marks collection.');
    return undefined;
  }
  const seenMarkTypes = new Set<string>();
  const sanitized = marks.flatMap((mark) => {
    if (!mark || typeof mark.type !== 'string') {
      preflight.blockedReasons.add('Document text contains an invalid mark.');
      return [];
    }
    if (seenMarkTypes.has(mark.type)) {
      preflight.blockedReasons.add(`Document text contains duplicate “${mark.type}” marks.`);
      return [];
    }
    seenMarkTypes.add(mark.type);
    if (mark.type === 'link') {
      const href = mark.attrs?.href;
      if (typeof href !== 'string') {
        preflight.blockedReasons.add('Link is missing a valid URL.');
        return [];
      }
      if (!isSafeMarkdownUrl(href, 'link')) {
        preflight.blockedReasons.add('Link uses an unsafe URL.');
        return [];
      }
      return [{ type: 'link', attrs: { href } }];
    }
    if (['bold', 'italic', 'code', 'underline'].includes(mark.type)) {
      return [{ type: mark.type }];
    }
    preflight.warnings.add(`Unsupported mark “${mark.type}” was exported as plain text.`);
    return [];
  });
  if (seenMarkTypes.has('code') && seenMarkTypes.size > 1) {
    preflight.blockedReasons.add(
      'Inline code cannot be combined with other marks for Markdown export.',
    );
  }
  return sanitized;
};

type FileNodeContext =
  | 'block'
  | 'inline'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'tableRow'
  | 'tableCell';

const FILE_NODE_CONTEXTS: Readonly<Record<string, readonly FileNodeContext[]>> = {
  text: ['inline'],
  hardBreak: ['inline'],
  paragraph: ['block', 'tableCell'],
  heading: ['block', 'tableCell'],
  bulletList: ['block'],
  orderedList: ['block'],
  taskList: ['block'],
  listItem: ['bulletList', 'orderedList'],
  taskItem: ['taskList'],
  image: ['block'],
  table: ['block'],
  tableRow: ['table'],
  tableHeader: ['tableRow'],
  tableCell: ['tableRow'],
};

const sanitizeNodeForFile = (
  node: JSONContent,
  context: FileNodeContext,
  preflight: FileExportPreflight,
  depth: number,
): JSONContent | null => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    preflight.blockedReasons.add('Document contains an invalid node.');
    return null;
  }
  if (preflight.visited.has(node)) {
    preflight.blockedReasons.add('Document contains a reused or cyclic node structure.');
    return null;
  }
  preflight.visited.add(node);
  preflight.valueCount += 1;
  if (
    preflight.valueCount > MAX_MARKDOWN_STRUCTURE_VALUES ||
    depth > MAX_MARKDOWN_STRUCTURE_DEPTH
  ) {
    preflight.blockedReasons.add('Document structure exceeds safe Markdown export bounds.');
    return null;
  }
  if (typeof node.type !== 'string') {
    preflight.blockedReasons.add('Document contains a node without a valid type.');
    return null;
  }

  const allowedContexts = FILE_NODE_CONTEXTS[node.type];
  if (allowedContexts && !allowedContexts.includes(context)) {
    preflight.blockedReasons.add(
      `Document node “${node.type}” is not valid inside “${context}” content.`,
    );
    return null;
  }
  if (
    !allowedContexts &&
    ['bulletList', 'orderedList', 'taskList', 'table', 'tableRow', 'tableCell'].includes(context)
  ) {
    preflight.blockedReasons.add(
      `Unsupported node “${node.type}” is not valid inside “${context}” content.`,
    );
    return null;
  }

  const sanitizeChildren = (childContext: FileNodeContext) => {
    if (node.content === undefined) return [];
    if (!Array.isArray(node.content)) {
      preflight.blockedReasons.add(`Document node “${node.type}” has invalid content.`);
      return [];
    }
    return node.content.flatMap((child) => {
      const sanitized = sanitizeNodeForFile(child, childContext, preflight, depth + 1);
      return sanitized ? [sanitized] : [];
    });
  };

  const blockUnexpectedLeafContent = () => {
    if (node.content !== undefined && (!Array.isArray(node.content) || node.content.length > 0)) {
      preflight.blockedReasons.add(`Document leaf node “${node.type}” cannot contain children.`);
    }
  };

  switch (node.type) {
    case 'text':
      if (typeof node.text !== 'string') {
        preflight.blockedReasons.add('Document contains a text node without text.');
        return null;
      }
      blockUnexpectedLeafContent();
      return {
        type: 'text',
        text: node.text,
        marks: sanitizeMarksForFile(node.marks, preflight),
      };
    case 'hardBreak':
      blockUnexpectedLeafContent();
      return { type: 'hardBreak' };
    case 'paragraph':
      return { type: 'paragraph', content: sanitizeChildren('inline') };
    case 'heading': {
      const level = node.attrs?.level;
      if (typeof level !== 'number' || ![1, 2, 3].includes(level)) {
        preflight.blockedReasons.add('Heading level must be H1, H2, or H3 for Markdown export.');
      }
      const content = sanitizeChildren('inline');
      if (context === 'tableCell') {
        preflight.warnings.add('Table-cell block formatting is exported as plain text.');
        return { type: 'paragraph', content };
      }
      return {
        type: 'heading',
        attrs: { level },
        content,
      };
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const start = node.attrs?.start;
      if (
        node.type === 'orderedList' &&
        start !== undefined &&
        (!Number.isInteger(start) || (start as number) < 1)
      ) {
        preflight.blockedReasons.add('Ordered-list start must be a positive integer.');
      }
      const content = sanitizeChildren(node.type);
      if (!content.length) {
        preflight.blockedReasons.add(
          `Document list “${node.type}” must contain at least one item.`,
        );
      }
      return {
        type: node.type,
        attrs:
          node.type === 'orderedList' && Number.isInteger(start) && (start as number) >= 1
            ? { start: start as number }
            : undefined,
        content,
      };
    }
    case 'listItem':
    case 'taskItem': {
      if (node.type === 'taskItem' && typeof node.attrs?.checked !== 'boolean') {
        preflight.blockedReasons.add('Task-list items require a boolean checked state.');
      }
      const content = sanitizeChildren('block');
      if (content[0]?.type !== 'paragraph') {
        preflight.blockedReasons.add(`Document node “${node.type}” must begin with a paragraph.`);
      }
      return {
        type: node.type,
        attrs: node.type === 'taskItem' ? { checked: node.attrs?.checked === true } : undefined,
        content,
      };
    }
    case 'image': {
      blockUnexpectedLeafContent();
      const src = node.attrs?.src;
      if (typeof src !== 'string' || !src) {
        preflight.blockedReasons.add('Image is missing a preservable source URL.');
        return null;
      }
      if (!isSafeMarkdownUrl(src, 'image')) {
        preflight.blockedReasons.add('Image uses an unsafe URL.');
        return null;
      }
      if (node.attrs?.width != null || node.attrs?.height != null) {
        preflight.warnings.add('Image sizing is omitted from Markdown.');
      }
      const alt = node.attrs?.alt;
      if (alt !== undefined && alt !== null && typeof alt !== 'string') {
        preflight.blockedReasons.add('Image alt text is invalid.');
      }
      return { type: 'image', attrs: { src, alt: typeof alt === 'string' ? alt : '' } };
    }
    case 'table': {
      const content = sanitizeChildren('table');
      if (content[0]?.content?.some((cell) => cell.type === 'tableCell')) {
        preflight.warnings.add('First-row table cells are promoted to headers in Markdown.');
      }
      if (
        content.slice(1).some((row) => row.content?.some((cell) => cell.type === 'tableHeader'))
      ) {
        preflight.warnings.add(
          'Table headers after the first row are demoted to ordinary cells in Markdown.',
        );
      }
      if (!content.length) {
        preflight.blockedReasons.add('Document table must contain at least one row.');
      }
      const columnCount = content[0]?.content?.length ?? 0;
      if (columnCount === 0 || content.some((row) => (row.content?.length ?? 0) !== columnCount)) {
        preflight.blockedReasons.add('Document table rows must have one consistent cell count.');
      }
      return { type: 'table', content };
    }
    case 'tableRow': {
      const content = sanitizeChildren('tableRow');
      if (!content.length) {
        preflight.blockedReasons.add('Document table row must contain at least one cell.');
      }
      return { type: 'tableRow', content };
    }
    case 'tableHeader':
    case 'tableCell': {
      const attrs = node.attrs ?? {};
      if (attrs.colspan != null && attrs.colspan !== 1) {
        preflight.warnings.add('Merged table-cell spans are flattened in Markdown.');
      }
      if (attrs.rowspan != null && attrs.rowspan !== 1) {
        preflight.warnings.add('Merged table-cell spans are flattened in Markdown.');
      }
      if (attrs.colwidth != null) {
        preflight.warnings.add('Table-cell column widths are omitted from Markdown.');
      }
      const cellType = sanitizeCellType(attrs.cellType);
      const sharePicker = preflight.shareCopy && node.type === 'tableCell' && cellType !== 'text';
      const legacyCellAttributes =
        !preflight.shareCopy &&
        ((typeof attrs.cellType === 'string' && attrs.cellType !== 'text') ||
          attrs.value ||
          (Array.isArray(attrs.options) && attrs.options.length));
      if (sharePicker) {
        preflight.warnings.add('Status and select cells are copied as their displayed labels.');
      } else if (legacyCellAttributes) {
        preflight.warnings.add(
          'Table controls become plain text. This download includes stored cell text and values, including any hidden in the editor.',
        );
      }
      // Check the source children even when the picker hides them from readers.
      let content = sanitizeChildren('tableCell');
      if (!content.length) {
        preflight.blockedReasons.add(`Document node “${node.type}” must contain a paragraph.`);
      }
      const value = typeof attrs.value === 'string' ? attrs.value : '';
      if (sharePicker) {
        const providedOptions = Array.isArray(attrs.options)
          ? attrs.options.filter((option): option is string => typeof option === 'string')
          : [];
        const options = resolveOptions(cellType, providedOptions);
        const displayValue = options.includes(value) ? value : (options[0] ?? '');
        content = [
          {
            type: 'paragraph',
            content: displayValue ? [{ type: 'text', text: displayValue }] : [],
          },
        ];
      } else {
        if (content.length > 1) {
          preflight.warnings.add(
            'Table cells with multiple blocks were flattened into a single line because Markdown tables cannot represent multi-block cells.',
          );
        }
        if (
          !preflight.shareCopy &&
          value &&
          !visibleTextForSanitizedNodes(content).includes(value)
        ) {
          content.push({ type: 'paragraph', content: [{ type: 'text', text: value }] });
        }
      }
      return {
        type: node.type,
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content,
      };
    }
    default: {
      const blockedReasonCount = preflight.blockedReasons.size;
      const visibleText = visibleTextForUnsupportedNode(node, preflight, depth);
      if (!visibleText) {
        if (preflight.blockedReasons.size === blockedReasonCount) {
          preflight.blockedReasons.add(
            `Unsupported node “${node.type}” has no preservable visible text.`,
          );
        }
        return null;
      }
      preflight.warnings.add(
        `${context === 'inline' ? 'Unsupported inline node' : 'Unsupported node'} “${node.type}” was exported as plain text.`,
      );
      return context === 'inline'
        ? { type: 'text', text: visibleText }
        : { type: 'paragraph', content: [{ type: 'text', text: visibleText }] };
    }
  }
};

const prepareDocumentForMarkdownFile = (
  doc: JSONContent,
  shareCopy: boolean,
): { doc: JSONContent; warnings: string[]; blockedReasons: string[] } => {
  const preflight: FileExportPreflight = {
    shareCopy,
    warnings: new Set(),
    blockedReasons: new Set(),
    visited: new WeakSet(),
    valueCount: 0,
  };
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return {
      doc: { type: 'doc', content: [] },
      warnings: [],
      blockedReasons: ['Markdown export requires a valid document root.'],
    };
  }
  preflight.visited.add(doc);
  const content = doc.content.flatMap((node) => {
    const sanitized = sanitizeNodeForFile(node, 'block', preflight, 1);
    return sanitized ? [sanitized] : [];
  });
  return {
    doc: { type: 'doc', content },
    warnings: [...preflight.warnings],
    blockedReasons: [...preflight.blockedReasons],
  };
};

export const serializeDocToMarkdownFile = (
  doc: JSONContent,
  options: MarkdownFileSerializeOptions,
): MarkdownFileSerializeResult => {
  let normalizedTitle = 'Untitled document';
  let filename = 'untitled-document.md';
  let warnings: string[] = [];
  try {
    const shareCopy = options.mode === 'share-copy';
    const requestedTitle = options.title;
    normalizedTitle = normalizeMarkdownTitle(requestedTitle, normalizedTitle);
    filename = filenameForTitle(normalizedTitle, shareCopy ? undefined : options.documentId);
    const prepared = prepareDocumentForMarkdownFile(doc, shareCopy);
    if (requestedTitle !== normalizedTitle) {
      prepared.warnings.unshift('Document title was normalized for safe Markdown export.');
    }
    warnings = prepared.warnings;
    const blockedReasons = [...prepared.blockedReasons];
    if (utf8ByteLength(normalizedTitle) > MAX_MARKDOWN_TITLE_BYTES) {
      blockedReasons.unshift('Document title exceeds the 4,096-byte Markdown file limit.');
    }
    if (blockedReasons.length) {
      return {
        markdown: '',
        normalizedTitle,
        filename,
        warnings,
        blockedReasons: [...new Set(blockedReasons)],
      };
    }

    const serializedBody = serializeDocToMarkdown(prepared.doc);
    const warningSet = new Set([...warnings, ...serializedBody.warnings]);
    const titleRoot: Root = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: normalizedTitle }],
        },
      ],
    };
    const stringifyOptions: RemarkStringifyOptions = {
      bullet: '-',
      fences: true,
      listItemIndent: 'one',
    };
    const processor = unified().use(remarkGfm).use(remarkStringify, stringifyOptions);
    const titleMarkdown = processor.stringify(titleRoot).replace(/\n+$/u, '\n');
    const bodyMarkdown = serializedBody.markdown
      ? serializedBody.markdown.replace(/\r\n?/gu, '\n').replace(/\n+$/u, '\n')
      : '';
    const markdown = `${LASH_MARKDOWN_V1_MARKER}\n\n${titleMarkdown}${bodyMarkdown ? `\n${bodyMarkdown}` : ''}`;
    const exceedsImportLimit = shareCopy && utf8ByteLength(markdown) > MARKDOWN_FILE_MAX_BYTES;
    return {
      markdown: exceedsImportLimit ? '' : markdown,
      normalizedTitle,
      filename,
      warnings: [...warningSet],
      blockedReasons: exceedsImportLimit
        ? ['This copy exceeds the 2,000,000-byte Markdown import limit.']
        : [],
    };
  } catch {
    return {
      markdown: '',
      normalizedTitle,
      filename,
      warnings,
      blockedReasons: ['Document content could not be processed safely.'],
    };
  }
};
