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
  /** Intent set — every heading ID the user has chosen to collapse, even if
   *  the corresponding heading is not yet present in the current doc (e.g.
   *  after a fresh editor mount before `setContent`). Persisted as-is to
   *  localStorage so collapse survives page reload + reload-of-content. */
  collapsedIntent: Set<string>;
  /** Filtered set — `collapsedIntent ∩ currentHeadingIds`. Used to compute
   *  hidden decorations and the outline `.collapsed` flag. */
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
  collapsedIntent: Set<string>,
): OutlinePluginState => {
  const { outline, collapsed: filteredCollapsed } = computeOutlineItems(doc, collapsedIntent);
  const hiddenRanges = buildHiddenRanges(doc, outline, filteredCollapsed);
  const decorations = createHiddenDecorations(doc, hiddenRanges);
  return {
    collapsedIntent,
    collapsed: filteredCollapsed,
    outline,
    decorations,
  };
};

const findNextVisiblePosition = (doc: ProseMirrorNode, outline: OutlineItem[], targetId: string) => {
  const index = outline.findIndex((item) => item.headingId === targetId);
  if (index === -1) {
    return null;
  }
  const target = outline[index];

  // Find the first heading whose `from` is at or beyond `target.contentTo` —
  // i.e., the first heading OUTSIDE target's collapsed range. This skips
  // nested children (e.g., H3 inside the collapsed H2).
  for (let i = index + 1; i < outline.length; i += 1) {
    if (outline[i].from >= target.contentTo) {
      return outline[i].from;
    }
  }

  // No next-visible heading. If we returned target.contentTo here it would
  // equal doc.content.size and PMSelection.near(end, 1) would search backward
  // INTO the collapsed range (proconsult-m0/A P1). Fall back to a position
  // inside the still-visible target heading itself so the caret never lands
  // in hidden content.
  return Math.min(target.from + 1, doc.content.size);
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
        let collapsedIntent = prevState.collapsedIntent;
        const meta = tr.getMeta(OUTLINE_PLUGIN_KEY) as OutlineMeta | undefined;
        if (meta?.type === 'set-collapsed') {
          collapsedIntent = new Set(meta.collapsedIds);
        }
        if (!tr.docChanged && !meta) {
          return prevState;
        }
        const nextState = computeOutlineState(tr.doc, collapsedIntent);
        // Persist the INTENT set, not the filtered visible set, so collapse
        // survives a page reload + setContent reload. (Filtering against
        // currentHeadingIds happens at render time.)
        const shouldPersist =
          meta?.type === 'set-collapsed' || !setsEqual(prevState.collapsedIntent, nextState.collapsedIntent);
        if (shouldPersist) {
          config.persistence?.save(config.documentId, Array.from(nextState.collapsedIntent));
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
            // Toggle against the INTENT set so the persisted state includes
            // headings the user collapsed even if they aren't currently in
            // the doc (e.g. between reloads of the same document).
            const collapsed = new Set(pluginState.collapsedIntent);
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
            // Check INTENT — `collapsed` is the filtered visible set; if the
            // user has collapsed headings that aren't currently in the doc
            // (e.g. between reloads), expand-all should clear those too.
            if (!pluginState.collapsedIntent.size) {
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
