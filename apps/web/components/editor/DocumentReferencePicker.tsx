'use client';

import { parseDateMention } from '@lash/mentions';
import type { VisibleMentionResult } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import styles from './DocumentReferencePicker.module.css';
import { type DocumentReference } from '../../lib/documentReferenceCatalog';
import { documentPath } from '../../lib/documentRegistry';

type ReferenceTrigger = { from: number; to: number; query: string };
type ReferenceOption =
  | { kind: 'date'; value: VisibleMentionResult }
  | { kind: 'document'; value: DocumentReference };

const readTrigger = (editor: Editor): ReferenceTrigger | null => {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return null;
  const { selection } = editor.state;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ((editor.state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)) return null;

  const fromOffset = Math.max(0, $from.parentOffset - 82);
  const prefix = $from.parent.textBetween(fromOffset, $from.parentOffset, '\n', '\uFFFC');
  const match = /(?:^|[\s(\[{])@([^@\n\uFFFC]{0,80})$/u.exec(prefix);
  if (!match) return null;
  const query = match[1];
  return { query, to: $from.pos, from: $from.pos - query.length - 1 };
};

const sameTrigger = (left: ReferenceTrigger | null, right: ReferenceTrigger | null) =>
  left?.from === right?.from && left?.to === right?.to && left?.query === right?.query;

const optionText = (option: ReferenceOption) =>
  option.kind === 'date' ? option.value.display : option.value.title;

export function DocumentReferencePicker({
  editor,
  searchDocuments,
}: {
  editor: Editor;
  searchDocuments: (query: string) => DocumentReference[];
}) {
  const popup = useRef<HTMLDivElement>(null);
  const dismissed = useRef<ReferenceTrigger | null>(null);
  const currentTrigger = useRef<ReferenceTrigger | null>(null);
  const [trigger, setTrigger] = useState<ReferenceTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo<ReferenceOption[]>(() => {
    if (!trigger || trigger.query.trim() === '') return [];
    const date = parseDateMention(trigger.query, {
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return [
      ...(date ? [{ kind: 'date', value: date } as const] : []),
      ...searchDocuments(trigger.query).map((value) => ({ kind: 'document', value }) as const),
    ];
  }, [searchDocuments, trigger]);

  const publishTrigger = useCallback((next: ReferenceTrigger | null) => {
    if (sameTrigger(next, currentTrigger.current)) return;
    currentTrigger.current = next;
    setTrigger(next);
    setActiveIndex(0);
  }, []);

  const refresh = useCallback(() => {
    if (!editor.isFocused) return;
    const next = readTrigger(editor);
    if (next && sameTrigger(next, dismissed.current)) return;
    dismissed.current = null;
    publishTrigger(next);
  }, [editor, publishTrigger]);

  useEffect(() => {
    const hide = () => {
      dismissed.current = null;
      publishTrigger(null);
    };
    const readAfterComposition = () => requestAnimationFrame(refresh);
    editor.on('transaction', refresh);
    editor.on('focus', refresh);
    editor.on('blur', hide);
    const input = editor.view.dom;
    input.addEventListener('compositionend', readAfterComposition);
    return () => {
      editor.off('transaction', refresh);
      editor.off('focus', refresh);
      editor.off('blur', hide);
      input.removeEventListener('compositionend', readAfterComposition);
    };
  }, [editor, publishTrigger, refresh]);

  const insert = useCallback(
    (option: ReferenceOption) => {
      if (!trigger || !sameTrigger(trigger, readTrigger(editor))) return;
      let node;
      if (option.kind === 'date') {
        const { kind, refId, display, iso } = option.value;
        node = { type: 'mention', attrs: { kind, refId, display, iso } };
      } else {
        const refId = option.value.id;
        if (!searchDocuments(trigger.query).some((document) => document.id === refId)) return;
        node = { type: 'chip', attrs: { refId, href: documentPath(refId) } };
      }
      editor
        .chain()
        .focus()
        .insertContentAt(trigger, [node, { type: 'text', text: ' ' }])
        .run();
      publishTrigger(null);
    },
    [editor, publishTrigger, searchDocuments, trigger],
  );

  useEffect(() => {
    if (!trigger || options.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) ||
        !sameTrigger(trigger, readTrigger(editor))
      )
        return;
      switch (event.key) {
        case 'ArrowDown':
          setActiveIndex((index) => (index + 1) % options.length);
          break;
        case 'ArrowUp':
          setActiveIndex((index) => (index + options.length - 1) % options.length);
          break;
        case 'Enter':
          insert(options[activeIndex] ?? options[0]);
          break;
        case 'Escape':
          dismissed.current = trigger;
          publishTrigger(null);
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const input = editor.view.dom;
    input.addEventListener('keydown', onKey, true);
    return () => input.removeEventListener('keydown', onKey, true);
  }, [activeIndex, editor, insert, options, publishTrigger, trigger]);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!trigger || !element) return;
    const position = () => {
      if (editor.isDestroyed || !sameTrigger(trigger, readTrigger(editor))) return;
      const anchor = editor.view.coordsAtPos(trigger.from);
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      if (anchor.top < top || anchor.bottom > bottom) {
        element.style.visibility = 'hidden';
        return;
      }
      element.style.visibility = 'visible';
      element.style.left = `${Math.max(left + 8, Math.min(anchor.left, right - width - 8))}px`;
      element.style.top = `${
        anchor.bottom + height + 14 <= bottom
          ? anchor.bottom + 6
          : Math.max(top + 8, anchor.top - height - 6)
      }px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [editor, options.length, trigger]);

  const active = options[activeIndex] ?? options[0];
  return (
    <>
      <div className="sr-only" aria-live="polite">
        {active ? `${optionText(active)}, ${active.kind}. Use up or down and Enter to insert.` : ''}
      </div>
      {options.length > 0 ? (
        <div ref={popup} className={styles.popup}>
          <div role="listbox" aria-label="Insert a reference" data-testid="reference-picker">
            {options.map((option, index) => (
              <button
                key={option.kind === 'date' ? option.value.refId : option.value.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                className={styles.option}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insert(option)}
              >
                <span>{optionText(option)}</span>
                <span className={styles.kind}>{option.kind === 'date' ? 'Date' : 'Document'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
