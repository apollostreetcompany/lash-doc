'use client';

import { parseDateMention } from '@lash/mentions';
import type { VisibleMentionResult } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './DocumentReferencePicker.module.css';
import { type DocumentReference } from '../../lib/documentReferenceCatalog';
import { documentPath } from '../../lib/documentRegistry';

type ReferenceTrigger = { from: number; to: number; query: string };
type ReferenceOption =
  | { kind: 'date'; value: VisibleMentionResult }
  | { kind: 'document'; value: DocumentReference };

type ReferencePickerState =
  | { kind: 'closed' }
  | { kind: 'dismissed'; editor: Editor; trigger: ReferenceTrigger }
  | { kind: 'open'; editor: Editor; trigger: ReferenceTrigger; activeKey: string | null };

const closedPicker = { kind: 'closed' } as const;

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

const optionKey = (option: ReferenceOption) =>
  option.kind === 'date' ? `date:${option.value.refId}` : `document:${option.value.id}`;

export function DocumentReferencePicker({
  editor,
  searchDocuments,
}: {
  editor: Editor;
  searchDocuments: (query: string) => DocumentReference[];
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<ReferencePickerState>(closedPicker);
  const currentPicker = useRef<ReferencePickerState>(closedPicker);
  const trigger = picker.kind === 'open' && picker.editor === editor ? picker.trigger : null;
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

  const publishPicker = useCallback((next: ReferencePickerState) => {
    if (next === currentPicker.current) return;
    currentPicker.current = next;
    setPicker(next);
  }, []);

  useEffect(() => {
    let compositionFrame: number | null = null;
    let composing = false;
    const cancelCompositionFrame = () => {
      if (compositionFrame === null) return;
      cancelAnimationFrame(compositionFrame);
      compositionFrame = null;
    };
    const refresh = () => {
      if (!editor.isFocused || composing) return;
      const next = readTrigger(editor);
      const current = currentPicker.current;
      if (
        next &&
        current.kind !== 'closed' &&
        current.editor === editor &&
        sameTrigger(next, current.trigger)
      )
        return;
      publishPicker(next ? { kind: 'open', editor, trigger: next, activeKey: null } : closedPicker);
    };
    const hide = () => {
      cancelCompositionFrame();
      composing = false;
      publishPicker(closedPicker);
    };
    const startComposition = () => {
      cancelCompositionFrame();
      composing = true;
      publishPicker(closedPicker);
    };
    const finishComposition = () => {
      cancelCompositionFrame();
      composing = false;
      compositionFrame = requestAnimationFrame(() => {
        compositionFrame = null;
        refresh();
      });
    };
    editor.on('transaction', refresh);
    editor.on('focus', refresh);
    editor.on('blur', hide);
    const input = editor.view.dom;
    input.addEventListener('compositionstart', startComposition);
    input.addEventListener('compositionend', finishComposition);
    refresh();
    return () => {
      cancelCompositionFrame();
      editor.off('transaction', refresh);
      editor.off('focus', refresh);
      editor.off('blur', hide);
      input.removeEventListener('compositionstart', startComposition);
      input.removeEventListener('compositionend', finishComposition);
    };
  }, [editor, publishPicker]);

  const insert = useCallback(
    (option: ReferenceOption) => {
      const current = currentPicker.current;
      if (
        !trigger ||
        current.kind !== 'open' ||
        current.editor !== editor ||
        current.trigger !== trigger ||
        !sameTrigger(trigger, readTrigger(editor))
      )
        return;
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
      publishPicker(closedPicker);
    },
    [editor, publishPicker, searchDocuments, trigger],
  );

  useEffect(() => {
    if (!trigger || options.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const current = currentPicker.current;
      if (
        current.kind !== 'open' ||
        current.editor !== editor ||
        current.trigger !== trigger ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) ||
        !sameTrigger(trigger, readTrigger(editor))
      )
        return;

      const index = Math.max(
        0,
        options.findIndex((option) => optionKey(option) === current.activeKey),
      );
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const next = options[(index + direction + options.length) % options.length];
          const activeKey = optionKey(next);
          if (activeKey !== current.activeKey) publishPicker({ ...current, activeKey });
          break;
        }
        case 'Enter':
          insert(options[index]);
          break;
        case 'Escape':
          publishPicker({ kind: 'dismissed', editor, trigger });
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
  }, [editor, insert, options, publishPicker, trigger]);

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

  const preferredKey = picker.kind === 'open' ? picker.activeKey : null;
  const active = options.find((option) => optionKey(option) === preferredKey) ?? options[0];
  return (
    <>
      <div className="sr-only" aria-live="polite">
        {active ? `${optionText(active)}, ${active.kind}. Use up or down and Enter to insert.` : ''}
      </div>
      {options.length > 0
        ? createPortal(
            <div ref={popup} className={styles.popup}>
              <div role="listbox" aria-label="Insert a reference" data-testid="reference-picker">
                {options.map((option) => (
                  <button
                    key={optionKey(option)}
                    type="button"
                    role="option"
                    aria-selected={option === active}
                    tabIndex={-1}
                    className={styles.option}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => insert(option)}
                  >
                    <span>{optionText(option)}</span>
                    <span className={styles.kind}>
                      {option.kind === 'date' ? 'Date' : 'Document'}
                    </span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
