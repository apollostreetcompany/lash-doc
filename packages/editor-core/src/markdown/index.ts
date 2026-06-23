import type { JSONContent } from '@tiptap/core';
import type {
  Content,
  Definition,
  BlockContent,
  Heading,
  Image,
  ImageReference,
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

export interface MarkdownImportResult {
  doc: JSONContent;
  warnings: string[];
}

export interface MarkdownImportOptions {
  documentId?: string;
}

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
          marks: marks.length ? marks : undefined,
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
            marks: marks.length ? marks : undefined,
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
            marks: marks.length ? marks : undefined,
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
    return { src: node.url ?? '', alt: node.alt ?? undefined };
  }
  const definition = definitions.get(node.identifier);
  if (!definition) {
    warnings.add(`Missing image definition for reference “${node.identifier}”.`);
    return null;
  }
  return { src: definition.url ?? '', alt: node.alt ?? undefined };
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
          attrs: list.ordered ? { start: list.start ?? 1 } : undefined,
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
