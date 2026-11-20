'use client';

import type { Editor, EditorEvents, Range as EditorRange } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import styles from './SelectionActions.module.css';
import {
  getWritingModelAvailability,
  MAX_AI_SELECTION_LENGTH,
} from '../../lib/browserWritingModel';
import { Icon } from '../shell/Icon';

interface SelectionActionsProps {
  editor: Editor;
  onComment?: (range: EditorRange) => void;
  onRevise?: (trigger: HTMLButtonElement) => void;
}

interface SelectionContext extends EditorRange {
  document: Editor['state']['doc'];
  modelSelection: Editor['state']['selection'];
  nativeRange: Range;
  canRevise: boolean;
}

function readSelection(editor: Editor): SelectionContext | null {
  const { view, state } = editor;
  const native = view.dom.ownerDocument.getSelection();
  if (!native || native.isCollapsed || native.rangeCount !== 1) return null;
  const nativeRange = native.getRangeAt(0);
  const insideEditor = (node: Node) =>
    view.dom.contains(node) &&
    (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest(
      '[contenteditable]',
    ) === view.dom;
  if (!insideEditor(nativeRange.startContainer) || !insideEditor(nativeRange.endContainer)) {
    return null;
  }

  try {
    const from = view.posAtDOM(nativeRange.startContainer, nativeRange.startOffset);
    const to = view.posAtDOM(nativeRange.endContainer, nativeRange.endOffset);
    const { doc, selection } = state;
    const start = doc.resolve(from);
    const end = doc.resolve(to);
    if (from >= to || !start.parent.inlineContent || !end.parent.inlineContent) return null;
    if (!doc.textBetween(from, to, '\n').trim()) return null;

    let textOnly = true;
    doc.nodesBetween(from, to, (node) => {
      if (node.isAtom && !node.isText) textOnly = false;
    });
    if (!textOnly) return null;

    const canRevise =
      editor.isEditable &&
      selection instanceof TextSelection &&
      selection.from === from &&
      selection.to === to &&
      to - from <= MAX_AI_SELECTION_LENGTH &&
      start.sameParent(end);
    return {
      document: doc,
      modelSelection: selection,
      nativeRange: nativeRange.cloneRange(),
      from,
      to,
      canRevise,
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function isSameSelection(previous: SelectionContext | null, next: SelectionContext | null) {
  return (
    previous === next ||
    (previous &&
      next &&
      previous.document === next.document &&
      previous.from === next.from &&
      previous.to === next.to &&
      previous.canRevise === next.canRevise &&
      previous.modelSelection.eq(next.modelSelection))
  );
}

function readCurrentSelection(
  editor: Editor,
  actions: HTMLDivElement | null,
  previous: SelectionContext | null,
) {
  if (editor.isDestroyed) return null;
  // A cell or node selection cannot supply an editable text anchor. Checking the
  // browser Selection here would also flush pending layout during dispatch.
  if (editor.isEditable && !(editor.state.selection instanceof TextSelection)) return null;
  const observed = readSelection(editor);
  if (observed) return observed;

  const ownerDocument = editor.view.dom.ownerDocument;
  const native = ownerDocument.getSelection();
  // A browser may clear the DOM selection when Tab moves focus to the comment action.
  if (
    native?.isCollapsed &&
    previous &&
    actions?.contains(ownerDocument.activeElement) &&
    previous.document === editor.state.doc &&
    previous.modelSelection.eq(editor.state.selection)
  ) {
    return previous;
  }
  return null;
}

function positionActions(actions: HTMLDivElement, selection: Range, touch: boolean) {
  const paper = actions.offsetParent;
  const window = actions.ownerDocument.defaultView;
  if (!paper || !window) return;

  const paperRect = paper.getBoundingClientRect();
  const canvas = actions.closest('.lash-canvas');
  const canvasRect = canvas?.getBoundingClientRect();
  const toolbarRect = canvas
    ?.querySelector('.lash-toolbar-bar:not([hidden])')
    ?.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const minLeft = Math.max(paperRect.left, canvasRect?.left ?? 0, viewportLeft) + 8;
  const maxRight =
    Math.min(
      paperRect.right,
      canvasRect?.right ?? window.innerWidth,
      viewportLeft + (viewport?.width ?? window.innerWidth),
    ) - 8;
  const minTop =
    Math.max(paperRect.top, viewportTop, canvasRect?.top ?? 0, toolbarRect?.bottom ?? 0) + 8;
  const maxBottom =
    Math.min(
      paperRect.bottom,
      canvasRect?.bottom ?? window.innerHeight,
      viewportTop + (viewport?.height ?? window.innerHeight),
    ) - 8;
  const rect = selection.getBoundingClientRect();
  const visible =
    rect.bottom >= minTop &&
    rect.top <= maxBottom &&
    rect.right >= minLeft &&
    rect.left <= maxRight;
  const { offsetHeight: height, offsetWidth: width } = actions;
  const gap = touch ? 24 : 8;
  const above = rect.top - gap - height;
  const below = rect.bottom + gap;
  const fitsAbove = above >= minTop && above + height <= maxBottom;
  const fitsBelow = below >= minTop && below + height <= maxBottom;
  if (!visible || maxRight - minLeft < width || maxBottom - minTop < height) {
    actions.style.visibility = 'hidden';
    return;
  }

  const left =
    fitsAbove || fitsBelow
      ? Math.max(minLeft, Math.min(rect.left, maxRight - width))
      : maxRight - width;
  const preferredTop = fitsBelow && (touch || !fitsAbove) ? below : above;
  const edge = touch ? below : above;
  const top =
    fitsAbove || fitsBelow ? preferredTop : Math.max(minTop, Math.min(edge, maxBottom - height));
  actions.style.left = `${left - paperRect.left}px`;
  actions.style.top = `${top - paperRect.top}px`;
  actions.style.visibility = 'visible';
}

export function SelectionActions({ editor, onComment, onRevise }: SelectionActionsProps) {
  const [desktop, setDesktop] = useState(false);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [context, setContext] = useState<SelectionContext | null>(null);
  const currentContext = useRef<SelectionContext | null>(null);
  const pressedContext = useRef<SelectionContext | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const revisionEnabled = Boolean(onRevise);

  useEffect(() => {
    const pointer = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const syncViewport = () => setDesktop(pointer.matches);
    syncViewport();
    pointer.addEventListener('change', syncViewport);
    return () => pointer.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (!desktop || !revisionEnabled) {
      setModelAvailable(false);
      return;
    }
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
  }, [desktop, revisionEnabled]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    const ownerDocument = editor.view.dom.ownerDocument;

    const syncSelection = () => {
      const previous = currentContext.current;
      const next = readCurrentSelection(editor, actionsRef.current, previous);
      if (isSameSelection(previous, next)) return;
      currentContext.current = next;
      setContext(next);
    };
    const syncModelSelection = () => {
      // Native selectionchange still handles a highlight before the model catches up.
      if (editor.isEditable && editor.state.selection.empty && !currentContext.current) return;
      syncSelection();
    };
    const syncEdit = ({ transaction }: EditorEvents['transaction']) => {
      if (transaction.docChanged) syncModelSelection();
    };
    const dismiss = () => {
      if (!currentContext.current) return;
      currentContext.current = null;
      setContext(null);
    };
    const releaseOnOutsideFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !editor.view.dom.contains(event.target) &&
        !actionsRef.current?.contains(event.target)
      ) {
        dismiss();
      }
    };
    const releaseOnOutsidePress = (event: PointerEvent) => {
      const actions = actionsRef.current;
      if (
        actions?.contains(ownerDocument.activeElement) &&
        event.target instanceof Node &&
        !actions.contains(event.target)
      ) {
        dismiss();
      }
    };
    ownerDocument.addEventListener('selectionchange', syncSelection);
    ownerDocument.addEventListener('pointerdown', releaseOnOutsidePress, true);
    ownerDocument.addEventListener('focusin', releaseOnOutsideFocus);
    editor.on('selectionUpdate', syncModelSelection);
    editor.on('transaction', syncEdit);
    syncSelection();
    return () => {
      ownerDocument.removeEventListener('selectionchange', syncSelection);
      ownerDocument.removeEventListener('pointerdown', releaseOnOutsidePress, true);
      ownerDocument.removeEventListener('focusin', releaseOnOutsideFocus);
      editor.off('selectionUpdate', syncModelSelection);
      editor.off('transaction', syncEdit);
    };
  }, [editor]);

  const showRevision = Boolean(onRevise && desktop && modelAvailable && context?.canRevise);
  const showActions = Boolean(onComment || showRevision);

  useLayoutEffect(() => {
    const actions = actionsRef.current;
    if (!context || !showActions || !actions) return;
    const window = actions.ownerDocument.defaultView;
    if (!window) return;
    const touch = window.matchMedia('(pointer: coarse)');
    const reposition = () => positionActions(actions, context.nativeRange, touch.matches);
    const resize = new ResizeObserver(reposition);
    resize.observe(actions);
    if (actions.offsetParent) resize.observe(actions.offsetParent);
    reposition();
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    touch.addEventListener('change', reposition);
    return () => {
      resize.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      touch.removeEventListener('change', reposition);
    };
  }, [context, showActions, showRevision]);

  if (!context || !showActions) return null;

  const selectedRange = (clickCount: number) => {
    const intended = clickCount && pressedContext.current ? pressedContext.current : context;
    pressedContext.current = null;
    const current = readCurrentSelection(editor, actionsRef.current, currentContext.current);
    return current?.document === intended.document &&
      current.from === intended.from &&
      current.to === intended.to
      ? current
      : null;
  };

  return (
    <div
      aria-label="Selection actions"
      className={styles.actions}
      ref={actionsRef}
      role="group"
      onPointerDown={(event) => {
        pressedContext.current = context;
        event.preventDefault();
      }}
      onPointerCancel={() => {
        pressedContext.current = null;
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {onComment ? (
        <button
          type="button"
          className={styles.action}
          onClick={(event) => {
            const range = selectedRange(event.detail);
            if (range) onComment({ from: range.from, to: range.to });
          }}
        >
          <Icon name="message" />
          Comment
        </button>
      ) : null}
      {showRevision ? (
        <button
          type="button"
          className={styles.action}
          onClick={(event) => {
            if (selectedRange(event.detail)?.canRevise) onRevise?.(event.currentTarget);
          }}
        >
          <Icon name="sparkles" />
          Revise selection
        </button>
      ) : null}
    </div>
  );
}
