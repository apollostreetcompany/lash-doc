import { applyTextOperations } from '@lash/ai';
import type { EditPatch } from '@lash/types';
import { getTextBetween, getTextSerializersFromSchema, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

interface TextRange {
  from: number;
  to: number;
}

export interface AiSelection {
  document: ProseMirrorNode;
  text: string;
  plaintextRange: TextRange;
  pmRange: TextRange;
  canReplace: boolean;
}

export function getAiSelection(
  editor: Editor | null,
  currentText: string,
  range: TextRange | undefined = editor?.state.selection,
): AiSelection | null {
  if (!editor || !range) return null;
  const { doc } = editor.state;
  const { from, to } = range;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= to ||
    to > doc.content.size
  ) {
    return null;
  }

  const options = {
    blockSeparator: '\n',
    textSerializers: getTextSerializersFromSchema(editor.schema),
  };
  if (editor.getText({ blockSeparator: options.blockSeparator }) !== currentText) return null;

  // Prefix length identifies the selected occurrence even when the same text
  // appears elsewhere or an inline node serializes to more than one character.
  const prefix = getTextBetween(doc, { from: 0, to: from }, options);
  const text = getTextBetween(doc, range, options);
  const suffix = getTextBetween(doc, { from: to, to: doc.content.size }, options);
  if (!text || `${prefix}${text}${suffix}` !== currentText) return null;

  const start = doc.resolve(from);
  const end = doc.resolve(to);
  let canReplace = start.sameParent(end) && start.parent.isTextblock;
  if (canReplace) {
    doc.nodesBetween(from, to, (node) => {
      if (node.isInline && !node.isText) canReplace = false;
    });
  }

  return {
    document: doc,
    text,
    plaintextRange: { from: prefix.length, to: prefix.length + text.length },
    pmRange: { from, to },
    canReplace,
  };
}

export function isAiSelectionCurrent(editor: Editor, selection: AiSelection): boolean {
  const { doc, selection: current } = editor.state;
  return (
    doc === selection.document &&
    current.from === selection.pmRange.from &&
    current.to === selection.pmRange.to
  );
}

export function prepareAiReplacement(editor: Editor, patch: EditPatch, selection: AiSelection) {
  if (editor.isDestroyed || editor.view.composing || editor.state.doc !== selection.document) {
    return null;
  }
  if (!patch.allowGlobal && !isAiSelectionCurrent(editor, selection)) return null;

  const [operation] = patch.operations;
  const before = editor.getText({ blockSeparator: '\n' });
  const exact = getAiSelection(editor, before, selection.pmRange);
  if (
    patch.operations.length !== 1 ||
    operation?.op !== 'replace_text' ||
    !operation.text.trim() ||
    /[\r\n\u2028\u2029]/u.test(operation.text) ||
    !exact?.canReplace ||
    exact.text !== selection.text ||
    operation.text === exact.text ||
    operation.from !== exact.plaintextRange.from ||
    operation.to !== exact.plaintextRange.to ||
    (patch.allowGlobal === true && (operation.from !== 0 || operation.to !== before.length))
  ) {
    return null;
  }

  const transaction = editor.state.tr.insertText(
    operation.text,
    exact.pmRange.from,
    exact.pmRange.to,
  );
  transaction.doc.check();
  const after = applyTextOperations(before, patch.operations);
  const projected = getTextBetween(
    transaction.doc,
    { from: 0, to: transaction.doc.content.size },
    {
      blockSeparator: '\n',
      textSerializers: getTextSerializersFromSchema(editor.schema),
    },
  );
  return transaction.docChanged && projected === after ? { transaction, after } : null;
}
