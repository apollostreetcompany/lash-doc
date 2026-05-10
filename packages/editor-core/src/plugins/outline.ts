import { Extension, type CommandProps, type RawCommands } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection as PMSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { createHeadingIdPlugin } from './heading-id';

export interface OutlinePersistenceAdapter {
  load(docId: string): string[];
  save(docId: string, collapsedIds: string[]): void;
}

export interface OutlineItem {
  headingId: string;
  level: number;
  title: string;
  collapsed: boolean;
  descendantCount: number;
  hiddenBlockCount: number;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

interface OutlinePluginState {
  collapsed: Set<string>;
  outline: OutlineItem[];
  decorations: DecorationSet;
}

interface OutlineMeta {
  type: 'set-collapsed';
  collapsedIds: string[];
}

interface OutlinePluginConfig {
  persistence?: OutlinePersistenceAdapter;
  documentId: string;
}

const OUTLINE_PLUGIN_KEY = new PluginKey<OutlinePluginState>('lashOutline');

const setsEqual = (a: Set<string>, b: Set<string>) => {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
};

const buildHiddenRanges = (doc: ProseMirrorNode, items: OutlineItem[], collapsed: Set<string>) => {
  return items
    .filter((item) => collapsed.has(item.headingId) && item.contentFrom < item.contentTo)
    .map((item) => ({ from: item.contentFrom, to: item.contentTo }));
};

const countDocLevelBlocks = (doc: ProseMirrorNode, from: number, to: number) => {
  let count = 0;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (parent === doc && node.isBlock) {
      count += 1;
      return false;
    }
    return true;
  });
  return count;
};

const computeOutlineItems = (doc: ProseMirrorNode, collapsed: Set<string>) => {
  type RawHeading = {
    node: ProseMirrorNode;
    from: number;
    to: number;
    headingId: string;
    level: number;
    title: string;
  };

  const headings: RawHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') {
      return true;
    }
    const headingId = node.attrs.headingId ?? null;
    const level = node.attrs.level ?? 1;
    const title = node.textContent || `Heading ${headings.length + 1}`;
    headings.push({
      node,
      from: pos,
      to: pos + node.nodeSize,
      headingId: headingId ?? `heading-${pos}`,
      level,
      title,
    });
    return false;
  });

  const outline: OutlineItem[] = headings.map((heading, index) => {
    let nextIndex = headings.length;
    for (let i = index + 1; i < headings.length; i += 1) {
      if (headings[i].level <= heading.level) {
        nextIndex = i;
        break;
      }
    }

    const contentFrom = heading.to;
    const contentTo = nextIndex < headings.length ? headings[nextIndex].from : doc.content.size;

    let descendantCount = 0;
    for (let i = index + 1; i < headings.length; i += 1) {
      if (headings[i].level <= heading.level) {
        break;
      }
      descendantCount += 1;
    }

    const hiddenBlockCount = countDocLevelBlocks(doc, contentFrom, contentTo);

    return {
      headingId: heading.headingId,
      level: heading.level,
      title: heading.title,
      collapsed: collapsed.has(heading.headingId),
      descendantCount,
      hiddenBlockCount,
      from: heading.from,
      to: heading.to,
      contentFrom,
      contentTo,
    };
  });

  const validIds = new Set(outline.map((item) => item.headingId));
  const filteredCollapsed = new Set([...collapsed].filter((id) => validIds.has(id)));

  return { outline, collapsed: filteredCollapsed };
};

const createHiddenDecorations = (doc: ProseMirrorNode, ranges: Array<{ from: number; to: number }>) => {
  if (!ranges.length) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isBlock) {
      return true;
    }
    const shouldHide = ranges.some((range) => pos >= range.from && pos < range.to);
    if (shouldHide) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'lash-hidden-block' }));
      return false;
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
};

const computeOutlineState = (
  doc: ProseMirrorNode,
  collapsed: Set<string>,
): { collapsed: Set<string>; outline: OutlineItem[]; decorations: DecorationSet } => {
  const { outline, collapsed: filteredCollapsed } = computeOutlineItems(doc, collapsed);
  const hiddenRanges = buildHiddenRanges(doc, outline, filteredCollapsed);
  const decorations = createHiddenDecorations(doc, hiddenRanges);
  return {
    collapsed: filteredCollapsed,
    outline,
    decorations,
  };
};

const findNextVisiblePosition = (doc: ProseMirrorNode, outline: OutlineItem[], targetId: string) => {
  const target = outline.find((item) => item.headingId === targetId);
  if (!target) {
    return null;
  }
  // After collapsing target, the first visible block sits at target.contentTo —
  // which by construction equals the next sibling-or-uncle heading's `from` (or doc end).
  return Math.min(target.contentTo, doc.content.size);
};

const createOutlinePlugin = (config: OutlinePluginConfig) =>
  new Plugin<OutlinePluginState>({
    key: OUTLINE_PLUGIN_KEY,
    state: {
      init(_, state) {
        const initialIds = new Set(config.persistence?.load(config.documentId) ?? []);
        return computeOutlineState(state.doc, initialIds);
      },
      apply(tr, prevState) {
        let collapsed = prevState.collapsed;
        const meta = tr.getMeta(OUTLINE_PLUGIN_KEY) as OutlineMeta | undefined;
        if (meta?.type === 'set-collapsed') {
          collapsed = new Set(meta.collapsedIds);
        }
        if (!tr.docChanged && !meta) {
          return prevState;
        }
        const nextState = computeOutlineState(tr.doc, collapsed);
        const shouldPersist =
          meta?.type === 'set-collapsed' || !setsEqual(prevState.collapsed, nextState.collapsed);
        if (shouldPersist) {
          config.persistence?.save(config.documentId, Array.from(nextState.collapsed));
        }
        return nextState;
      },
    },
    props: {
      decorations(state) {
        const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
        return pluginState?.decorations ?? DecorationSet.empty;
      },
    },
  });

export const OutlineManager = Extension.create<{ persistence?: OutlinePersistenceAdapter; documentId?: string }>(
  {
    name: 'outlineManager',

    addOptions() {
      return {
        persistence: undefined,
        documentId: 'default',
      };
    },

    addCommands() {
      return {
        toggleHeadingCollapse:
          (headingId: string) =>
          ({ state, dispatch }: CommandProps) => {
            if (!headingId) {
              return false;
            }
            const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
            if (!pluginState) {
              return false;
            }
            const collapsed = new Set(pluginState.collapsed);
            let collapsedNow = false;
            if (collapsed.has(headingId)) {
              collapsed.delete(headingId);
            } else {
              collapsed.add(headingId);
              collapsedNow = true;
            }

            let tr = state.tr;
            if (collapsedNow) {
              const nextPos = findNextVisiblePosition(state.doc, pluginState.outline, headingId);
              if (typeof nextPos === 'number') {
                const pos = Math.min(Math.max(nextPos, 0), state.doc.content.size);
                const resolved = state.doc.resolve(pos);
                const selection: Selection = PMSelection.near(resolved, 1);
                tr = tr.setSelection(selection as TextSelection);
              }
            }

            if (dispatch) {
              const meta: OutlineMeta = {
                type: 'set-collapsed',
                collapsedIds: Array.from(collapsed),
              };
              dispatch(tr.setMeta(OUTLINE_PLUGIN_KEY, meta));
            }
            return true;
          },
        expandAllHeadings:
          () =>
          ({ state, dispatch }: CommandProps) => {
            const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
            if (!pluginState) {
              return false;
            }
            if (!pluginState.collapsed.size) {
              return true;
            }
            if (dispatch) {
              const meta: OutlineMeta = { type: 'set-collapsed', collapsedIds: [] };
              dispatch(state.tr.setMeta(OUTLINE_PLUGIN_KEY, meta));
            }
            return true;
          },
      } as Partial<RawCommands>;
    },

    addProseMirrorPlugins() {
      return [
        createHeadingIdPlugin(),
        createOutlinePlugin({
          documentId: this.options.documentId ?? 'default',
          persistence: this.options.persistence,
        }),
      ];
    },
  },
);

export const getOutlineItems = (state: EditorState): OutlineItem[] => {
  const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
  return pluginState ? pluginState.outline : [];
};

export const isHeadingCollapsed = (state: EditorState, headingId: string): boolean => {
  const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
  return pluginState ? pluginState.collapsed.has(headingId) : false;
};

export const getCollapsedHeadingIds = (state: EditorState): string[] => {
  const pluginState = OUTLINE_PLUGIN_KEY.getState(state);
  return pluginState ? Array.from(pluginState.collapsed) : [];
};
