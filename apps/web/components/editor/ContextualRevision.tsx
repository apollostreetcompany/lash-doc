'use client';

import type { Editor, EditorEvents } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEffect, useRef, useState } from 'react';

import styles from './ContextualRevision.module.css';
import {
  getWritingModelAvailability,
  MAX_AI_SELECTION_LENGTH,
} from '../../lib/browserWritingModel';
import { Icon } from '../shell/Icon';

function eligibleSelection(editor: Editor) {
  const selection = editor.state.selection;
  if (
    !editor.isEditable ||
    !(selection instanceof TextSelection) ||
    selection.empty ||
    selection.to - selection.from > MAX_AI_SELECTION_LENGTH ||
    !selection.$from.sameParent(selection.$to)
  ) {
    return null;
  }
  const { doc } = editor.state;
  let textOnly = true;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline && !node.isText) textOnly = false;
  });
  return textOnly && doc.textBetween(selection.from, selection.to).trim() ? selection : null;
}

interface ContextualRevisionProps {
  editor: Editor;
  onRevise: (trigger: HTMLButtonElement) => void;
}

interface SelectionContext {
  document: Editor['state']['doc'];
  from: number;
  to: number;
  left: number;
  top: number;
}

export function ContextualRevision({ editor, onRevise }: ContextualRevisionProps) {
  const [desktop, setDesktop] = useState(false);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [context, setContext] = useState<SelectionContext | null>(null);
  const currentContext = useRef<SelectionContext | null>(null);

  useEffect(() => {
    const pointer = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const syncViewport = () => setDesktop(pointer.matches);
    syncViewport();
    pointer.addEventListener('change', syncViewport);
    return () => pointer.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getWritingModelAvailability().then((outcome) => {
      if (active) {
        setModelAvailable(
          outcome === 'available' || outcome === 'downloadable' || outcome === 'downloading',
        );
      }
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop || !modelAvailable || editor.isDestroyed) return;
    const paper = editor.view.dom.closest('.lash-doc-paper');
    if (!paper) return;

    const syncPosition = () => {
      if (editor.isDestroyed) return;
      const selection = eligibleSelection(editor);
      const previous = currentContext.current;
      if (!selection) {
        if (previous) {
          currentContext.current = null;
          setContext(null);
        }
        return;
      }
      const paperRect = paper.getBoundingClientRect();
      const anchor = editor.view.coordsAtPos(selection.from);
      const left = Math.max(8, Math.min(anchor.left - paperRect.left, paperRect.width - 162));
      const top = anchor.top - paperRect.top - 8;
      const { doc } = editor.state;
      const { from, to } = selection;
      if (
        previous?.document === doc &&
        previous.from === from &&
        previous.to === to &&
        previous.left === left &&
        previous.top === top
      )
        return;
      const next = { document: doc, from, to, left, top };
      currentContext.current = next;
      setContext(next);
    };

    const syncEdit = ({ transaction }: EditorEvents['transaction']) => {
      if (transaction.docChanged && !editor.state.selection.empty) syncPosition();
    };
    const resize = new ResizeObserver(syncPosition);
    resize.observe(paper);
    syncPosition();
    editor.on('selectionUpdate', syncPosition);
    editor.on('transaction', syncEdit);
    return () => {
      resize.disconnect();
      editor.off('selectionUpdate', syncPosition);
      editor.off('transaction', syncEdit);
    };
  }, [desktop, editor, modelAvailable]);

  if (!desktop || !modelAvailable || !context) return null;
  return (
    <button
      type="button"
      className={styles.revise}
      style={{ left: context.left, top: context.top }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (editor.isDestroyed || editor.state.doc !== context.document) return;
        const selection = eligibleSelection(editor);
        if (selection?.from === context.from && selection.to === context.to) {
          onRevise(event.currentTarget);
        }
      }}
    >
      <Icon name="sparkles" />
      Revise selection
    </button>
  );
}
