'use client';

import { DEFAULT_SELECT_CELL_OPTIONS, DEFAULT_STATUS_CELL_OPTIONS } from '@lash/editor-core';
import { getTextSerializersFromSchema } from '@tiptap/core';
import { DOMSerializer, type Node as EditorNode } from '@tiptap/pm/model';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import styles from './HistoryVersionReader.module.css';

type HistoryVersion = Readonly<{ text: string; document?: EditorNode }>;
export type LoadHistoryVersion = (sha: string) => Promise<HistoryVersion | null>;

type VersionRead =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'ready'; version: HistoryVersion };

function projectVersion(doc: EditorNode, document: Document) {
  const schema = doc.type.schema;
  const existingNodes = DOMSerializer.nodesFromSchema(schema);
  const existingMarks = DOMSerializer.marksFromSchema(schema);
  const serializers = getTextSerializersFromSchema(schema);
  const nodes: typeof existingNodes = {};
  const marks: typeof existingMarks = {};
  // Reuse the writing schema's ordinary markup without mounting editor NodeViews.
  for (const type of [
    'text',
    'paragraph',
    'hardBreak',
    'horizontalRule',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'codeBlock',
    'taskList',
    'tableRow',
  ]) {
    if (existingNodes[type]) nodes[type] = existingNodes[type];
  }
  for (const type of ['bold', 'italic', 'strike', 'underline', 'code']) {
    if (existingMarks[type]) marks[type] = existingMarks[type];
  }
  const renderCell = (node: EditorNode, tag: 'td' | 'th') => {
    const { cellType, options, value, colspan, rowspan } = node.attrs;
    if (cellType !== 'status' && cellType !== 'select')
      return [tag, { colspan, rowspan }, 0] as const;
    const provided = Array.isArray(options)
      ? options.filter((option): option is string => typeof option === 'string')
      : [];
    const defaults =
      cellType === 'status' ? DEFAULT_STATUS_CELL_OPTIONS : DEFAULT_SELECT_CELL_OPTIONS;
    const choices = provided.length ? provided : defaults;
    const selected =
      typeof value === 'string' && choices.includes(value) ? value : (choices[0] ?? '');
    return [tag, { colspan, rowspan }, selected] as const;
  };
  const serializer = new DOMSerializer(
    {
      ...nodes,
      heading: (node) => [
        `h${[1, 2, 3].includes(node.attrs.level) ? node.attrs.level : 2}`,
        { dir: 'auto' },
        0,
      ],
      taskItem: (node) => ['li', ['span', node.attrs.checked ? '☑ ' : '☐ '], ['div', 0]],
      table: () => ['div', { class: styles.table }, ['table', ['tbody', 0]]],
      tableCell: (node) => renderCell(node, 'td'),
      tableHeader: (node) => renderCell(node, 'th'),
      image: (node) => [
        'p',
        typeof node.attrs.alt === 'string' && node.attrs.alt ? `Image: ${node.attrs.alt}` : 'Image',
      ],
      chip: () => ['span', 'Document link'],
      mention: (node) => [
        'span',
        serializers.mention?.({
          node,
          parent: doc,
          pos: 0,
          index: 0,
          range: { from: 0, to: node.nodeSize },
        }) ?? '@Mention',
      ],
    },
    marks,
  );
  return serializer.serializeFragment(doc.content, { document });
}

function VersionContents({ version }: { version: HistoryVersion }) {
  const contentRef = useRef<HTMLElement>(null);
  const [formatUnavailable, setFormatUnavailable] = useState(!version.document);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!version.document || !content) return;
    try {
      content.replaceChildren(projectVersion(version.document, content.ownerDocument));
    } catch {
      setFormatUnavailable(true);
    }
  }, [version]);

  return (
    <>
      {formatUnavailable ? (
        <p className={styles.note}>Formatting is unavailable for this version.</p>
      ) : null}
      <article
        ref={contentRef}
        className={`lash-editor-content ${styles.prose}`}
        aria-label="Version contents"
        dir="auto"
      >
        {formatUnavailable ? <div className={styles.plainText}>{version.text}</div> : null}
      </article>
    </>
  );
}

function OpenHistoryVersion({
  sequence,
  sha,
  load,
  onClose,
  onReturnToDocument,
  triggerRef,
}: {
  sequence: number;
  sha: string;
  load: LoadHistoryVersion;
  onClose(): void;
  onReturnToDocument?: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusToHistory = useRef(true);
  const [read, setRead] = useState<VersionRead>({ phase: 'loading' });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;
    dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocusToHistory.current && trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [triggerRef]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const version = await load(sha);
        if (active) setRead(version ? { phase: 'ready', version } : { phase: 'unavailable' });
      } catch {
        if (active) setRead({ phase: 'unavailable' });
      }
    })();
    return () => {
      active = false;
    };
  }, [load, sha]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            Version {sequence}
          </h2>
          <button
            className="history-filter-button"
            type="button"
            onClick={() => {
              // The mobile drawer restores focus to its own opener when it closes.
              returnFocusToHistory.current = !onReturnToDocument;
              onClose();
              onReturnToDocument?.();
            }}
          >
            Back to latest
          </button>
        </header>
        <div className={styles.scroll} role="region" aria-label="Version reader" tabIndex={0}>
          {read.phase === 'loading' ? <p role="status">Loading version…</p> : null}
          {read.phase === 'unavailable' ? (
            <p role="status">This version is unavailable to read.</p>
          ) : null}
          {read.phase === 'ready' ? <VersionContents version={read.version} /> : null}
        </div>
      </div>
    </dialog>
  );
}

export function HistoryVersionReader({
  sequence,
  sha,
  load,
  onReturnToDocument,
}: {
  sequence: number;
  sha: string;
  load: LoadHistoryVersion;
  onReturnToDocument?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [opening, setOpening] = useState<{ load: LoadHistoryVersion } | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        className={`history-filter-button ${styles.trigger}`}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpening({ load })}
      >
        Read version
      </button>
      {opening?.load === load ? (
        <OpenHistoryVersion
          sequence={sequence}
          sha={sha}
          load={load}
          triggerRef={triggerRef}
          onClose={() => setOpening(null)}
          onReturnToDocument={onReturnToDocument}
        />
      ) : null}
    </>
  );
}
