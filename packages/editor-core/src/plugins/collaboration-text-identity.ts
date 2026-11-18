import CollaborationExtension from '@tiptap/extension-collaboration';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import {
  ProsemirrorBinding,
  absolutePositionToRelativePosition,
  ySyncPluginKey,
} from 'y-prosemirror';
import * as Y from 'yjs';

import { isWellFormedSuggestionText } from '../suggestion-range';

type TextRun = { offset: number; text: string };

type TextReplacement = {
  beforeParent: ProseMirrorNode;
  after: ProseMirrorNode;
  position: number;
  beforeText: string;
  from: number;
  to: number;
  insert: string;
};

const textIdentityKey = new PluginKey<TextReplacement | null>('lashCollaborationTextIdentity');

function findTextRun(parent: ProseMirrorNode, from: number, to: number): TextRun | null {
  let start = 0;
  let pieces: string[] = [];
  let found: TextRun | null = null;
  const endRun = (end: number) => {
    if (pieces.length && start <= from && to <= end)
      found = { offset: start, text: pieces.join('') };
  };
  parent.forEach((child, offset) => {
    if (found) return;
    if (!child.isText || child.text === undefined) {
      endRun(offset);
      pieces = [];
      return;
    }
    if (!pieces.length) start = offset;
    pieces.push(child.text);
  });
  if (!found) endRun(parent.content.size);
  return found;
}

function hasAmbiguousDiff(parent: ProseMirrorNode, from: number, to: number, insert: string) {
  const characterAt = (index: number) =>
    index < parent.content.size ? parent.textBetween(index, index + 1) : '';
  const first = characterAt(from);
  // Upstream trims common prefix/suffix before splicing. If the splice edges
  // differ, its minimal diff already preserves the same character identities.
  return (
    (first !== '' && first === (insert[0] ?? characterAt(to))) ||
    (from < to && insert.length > 0 && characterAt(to - 1) === insert.at(-1))
  );
}

function readTextReplacement(transaction: Transaction): TextReplacement | null {
  if (
    transaction.getMeta(ySyncPluginKey) ||
    transaction.getMeta('appendedTransaction') ||
    transaction.steps.length !== 1
  )
    return null;
  const [step] = transaction.steps;
  if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return null;
  const from = transaction.before.resolve(step.from);
  const to = transaction.before.resolve(step.to);
  if (!from.sameParent(to) || !from.parent.isTextblock) return null;

  let inserted = '';
  let textOnly = true;
  step.slice.content.forEach((node) => {
    if (node.isText && node.text !== undefined) inserted += node.text;
    else textOnly = false;
  });
  if (!textOnly || !hasAmbiguousDiff(from.parent, from.parentOffset, to.parentOffset, inserted)) {
    return null;
  }

  const run = findTextRun(from.parent, from.parentOffset, to.parentOffset);
  const afterFrom = transaction.doc.resolve(step.from);
  if (!run || !afterFrom.parent.sameMarkup(from.parent) || afterFrom.start() !== from.start()) {
    return null;
  }
  const start = from.parentOffset - run.offset;
  const end = to.parentOffset - run.offset;
  const prefix = run.text.slice(0, start);
  const removed = run.text.slice(start, end);
  const suffix = run.text.slice(end);
  if (![prefix, removed, inserted, suffix].every(isWellFormedSuggestionText)) return null;
  const expected = prefix + inserted + suffix;
  if (!expected) return null;
  const nextRun = findTextRun(afterFrom.parent, run.offset, run.offset + expected.length);
  if (nextRun?.offset !== run.offset || nextRun.text !== expected) return null;
  return {
    beforeParent: from.parent,
    after: transaction.doc,
    position: from.start() + run.offset,
    beforeText: run.text,
    from: start,
    to: end,
    insert: inserted,
  };
}

function findMatchingYText(binding: ProsemirrorBinding, replacement: TextReplacement) {
  try {
    // Probe inside the run so adjacent inline atoms cannot own the boundary.
    const relative = absolutePositionToRelativePosition(
      replacement.position + 1,
      binding.type,
      binding.mapping,
    );
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, binding.doc);
    const text = absolute?.type;
    if (
      absolute?.index !== 1 ||
      !(text instanceof Y.XmlText) ||
      !(text.parent instanceof Y.XmlElement) ||
      binding.mapping.get(text.parent) !== replacement.beforeParent
    ) {
      return null;
    }
    const delta = text.toDelta() as Array<{ insert: unknown }>;
    return delta.every(({ insert }) => typeof insert === 'string') &&
      delta.map(({ insert }) => insert).join('') === replacement.beforeText
      ? text
      : null;
  } catch {
    return null;
  }
}

function createTextIdentityPlugin() {
  const consumed = new WeakSet<TextReplacement>();
  return new Plugin<TextReplacement | null>({
    key: textIdentityKey,
    state: {
      init: () => null,
      apply: (transaction, last) => {
        if (transaction.getMeta(ySyncPluginKey)) return null;
        return transaction.docChanged ? readTextReplacement(transaction) : last;
      },
    },
    view(view) {
      const binding: unknown = ySyncPluginKey.getState(view.state)?.binding;
      if (!(binding instanceof ProsemirrorBinding)) return {};
      const original = binding._prosemirrorChanged;
      binding._prosemirrorChanged = (doc) => {
        const replacement = textIdentityKey.getState(view.state);
        if (replacement && !consumed.has(replacement) && replacement.after === doc) {
          consumed.add(replacement);
          // y-prosemirror 1.3.7 calls this with the binding mutex held in its
          // native local transaction. Let its original method reconcile marks.
          const transaction = binding.doc._transaction;
          if (transaction?.local && transaction.origin === ySyncPluginKey) {
            const text = findMatchingYText(binding, replacement);
            if (text) {
              if (replacement.from < replacement.to)
                text.delete(replacement.from, replacement.to - replacement.from);
              if (replacement.insert) text.insert(replacement.from, replacement.insert);
            }
          }
        }
        original.call(binding, doc);
      };
      return {
        destroy: () => {
          binding._prosemirrorChanged = original;
        },
      };
    },
  });
}

export const LashCollaboration = CollaborationExtension.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createTextIdentityPlugin()];
  },
});
