import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';

const headingIdKey = new PluginKey('lashHeadingId');
export const headingInputStabilityKey = new PluginKey<boolean>('lashHeadingInputStability');

const deriveHeadingId = (pos: number) => `heading-${pos.toString(36)}`;

const createAvailableHeadingId = (reserved: Set<string>, pos: number) => {
  const base = deriveHeadingId(pos);
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

export const createUniqueHeadingId = (doc: ProseMirrorNode, pos: number) => {
  const used = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'heading' && typeof node.attrs.headingId === 'string') {
      const headingId = node.attrs.headingId.trim();
      if (headingId) used.add(headingId);
    }
    return true;
  });

  return createAvailableHeadingId(used, pos);
};

interface HeadingIdRepair {
  pos: number;
  node: ProseMirrorNode;
  attrs: ProseMirrorNode['attrs'];
}

const planHeadingIdRepairs = (doc: ProseMirrorNode): HeadingIdRepair[] => {
  const reserved = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== 'heading') {
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(node.type.spec.attrs ?? {}, 'headingId')) {
      throw new RangeError(`Heading node type "${node.type.name}" cannot represent headingId`);
    }
    if (typeof node.attrs.headingId === 'string') {
      const normalized = node.attrs.headingId.trim();
      if (normalized) reserved.add(normalized);
    }
    return true;
  });

  const preserved = new Set<string>();
  const repairs: HeadingIdRepair[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') {
      return true;
    }
    const current = typeof node.attrs.headingId === 'string' ? node.attrs.headingId.trim() : '';
    if (!current || preserved.has(current)) {
      const headingId = createAvailableHeadingId(reserved, pos);
      repairs.push({
        pos,
        node,
        attrs: {
          ...node.attrs,
          headingId,
        },
      });
      reserved.add(headingId);
      return true;
    }
    preserved.add(current);
    return true;
  });

  return repairs;
};

export const projectDocumentHeadingIds = (doc: ProseMirrorNode): ProseMirrorNode => {
  const repairs = planHeadingIdRepairs(doc);
  if (repairs.length === 0) {
    return doc;
  }

  const transform = new Transform(doc);
  for (const repair of repairs) {
    transform.setNodeMarkup(repair.pos, undefined, repair.attrs);
  }
  return transform.doc;
};

const annotateHeadings = (doc: ProseMirrorNode, state: EditorState): Transaction | null => {
  const repairs = planHeadingIdRepairs(doc);
  if (repairs.length === 0) {
    return null;
  }

  const tr = state.tr;
  let armNextTextInput = false;
  for (const repair of repairs) {
    tr.setNodeMarkup(repair.pos, undefined, repair.attrs);
    if (repair.node.content.size === 0 && state.selection.$from.parent === repair.node) {
      armNextTextInput = true;
    }
  }
  if (armNextTextInput) {
    tr.setMeta(headingInputStabilityKey, 'arm');
  }
  return tr;
};

export const createHeadingIdPlugin = () =>
  new Plugin({
    key: headingIdKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }
      const tr = annotateHeadings(newState.doc, newState);
      return tr ?? null;
    },
  });
