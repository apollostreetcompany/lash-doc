/**
 * panels/AIPanel — AI Edit invocation + accept/reject flow + chat citations.
 */
'use client';

import {
  suggestFallback,
  validateEditPatch,
  type ValidationResult,
  type ValidatorOptions,
} from '@lash/ai';
import type { DocumentId, EditPatch, EditPatchCitation } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useMemo, useRef, useState } from 'react';

export interface AIPanelProps {
  editor: Editor | null;
  docId: DocumentId;
  baseVersion: string | null;
  currentText: string;
  schemaVersion: string;
  open?: boolean;
  onApplyPatch: (patch: EditPatch) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

const AI_AUTHOR = { type: 'ai', id: 'ai-editor', label: 'AI Editor' } as const;

const SCHEMA_SUMMARY: ValidatorOptions['schemaSummary'] = {
  nodeTypes: [
    'doc',
    'paragraph',
    'heading',
    'bulletList',
    'orderedList',
    'listItem',
    'taskList',
    'taskItem',
    'image',
    'table',
    'tableRow',
    'tableCell',
    'chip',
  ],
  markTypes: ['bold', 'italic', 'underline', 'code', 'link'],
};

const selectedText = (editor: Editor | null): string => {
  if (!editor) return '';
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  return editor.state.doc.textBetween(from, to, '\n');
};

const improveText = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized ? `Polished ${normalized}` : 'Polished draft';
};

const validationMessage = (result: Exclude<ValidationResult, { ok: true }>) => {
  if (result.reason === 'doc-wide-without-confirm') return 'Global edit requires confirmation.';
  if (result.reason === 'out-of-scope') return 'AI patch was blocked because it exceeds selection.';
  if (result.reason === 'schema-invalid')
    return `AI patch rejected: ${result.details ?? 'schema invalid'}.`;
  return `AI patch rejected: ${result.reason}.`;
};

export function AIPanel({
  editor,
  docId,
  baseVersion,
  currentText,
  schemaVersion,
  open = true,
  onApplyPatch,
}: AIPanelProps) {
  const patchCounterRef = useRef(0);
  const [pendingPatch, setPendingPatch] = useState<EditPatch | null>(null);
  const [appliedPatch, setAppliedPatch] = useState<EditPatch | null>(null);
  const [fallbackPatch, setFallbackPatch] = useState<EditPatch | null>(null);
  const [status, setStatus] = useState('Select text to request an AI edit.');
  const [globalConfirmed, setGlobalConfirmed] = useState(false);
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [chatCitation, setChatCitation] = useState<Extract<
    EditPatchCitation,
    { type: 'doc' }
  > | null>(null);
  const [jumpTarget, setJumpTarget] = useState('');

  const selectionText = selectedText(editor);
  const selectionRange = useMemo(() => {
    if (!selectionText) return null;
    const from = currentText.indexOf(selectionText);
    if (from < 0) return null;
    return { from, to: from + selectionText.length };
  }, [currentText, selectionText]);
  const canRequestSelectionPatch = Boolean(editor && baseVersion && selectionRange);

  if (!open) return null;

  const nextPatchId = () => {
    patchCounterRef.current += 1;
    return `ai-patch:${patchCounterRef.current}`;
  };

  const validateAndStage = (patch: EditPatch, confirmations = {}) => {
    const result = validateEditPatch(patch, {
      baseDoc: { text: currentText },
      selection: selectionRange,
      schemaSummary: SCHEMA_SUMMARY,
      confirmations,
    });
    if (!result.ok) {
      setPendingPatch(null);
      setFallbackPatch(suggestFallback(patch, result));
      setStatus(validationMessage(result));
      return;
    }
    setPendingPatch(patch);
    setFallbackPatch(null);
    setStatus('AI patch ready for review.');
  };

  const createSelectionPatch = () => {
    if (!baseVersion || !selectionRange || !selectionText) {
      setStatus('Select text before requesting an AI edit.');
      return;
    }
    validateAndStage({
      patchId: nextPatchId(),
      docId,
      baseVersion,
      schemaVersion,
      author: AI_AUTHOR,
      createdAt: new Date().toISOString(),
      operations: [
        {
          op: 'replace_text',
          from: selectionRange.from,
          to: selectionRange.to,
          text: improveText(selectionText),
        },
      ],
      rationale: 'Tighten the selected wording while preserving the original meaning.',
      citations: [
        { type: 'doc', baseVersion, rangeFrom: selectionRange.from, rangeTo: selectionRange.to },
      ],
    });
  };

  const createInvalidPatch = () => {
    if (!baseVersion) return;
    validateAndStage({
      patchId: nextPatchId(),
      docId,
      baseVersion,
      schemaVersion,
      author: AI_AUTHOR,
      createdAt: new Date().toISOString(),
      operations: [
        { op: 'insert_node', pos: selectionRange?.from ?? 0, node: { type: 'unknownWidget' } },
      ],
      rationale: 'Attempt an unsupported structure.',
    });
  };

  const createGlobalPatch = () => {
    if (!baseVersion || !currentText) return;
    validateAndStage(
      {
        patchId: nextPatchId(),
        docId,
        baseVersion,
        schemaVersion,
        author: AI_AUTHOR,
        createdAt: new Date().toISOString(),
        operations: [
          {
            op: 'replace_text',
            from: 0,
            to: currentText.length,
            text: `Polished draft: ${currentText.replace(/\s+/g, ' ').trim()}`,
          },
        ],
        rationale: 'Rewrite the full document only after explicit user confirmation.',
        citations: [{ type: 'doc', baseVersion, rangeFrom: 0, rangeTo: currentText.length }],
        allowGlobal: true,
      },
      { globalEditConfirmed: globalConfirmed },
    );
  };

  const acceptPatch = async () => {
    if (!pendingPatch) return;
    const result = await onApplyPatch(pendingPatch);
    if (!result.ok) {
      setStatus(`AI patch failed: ${result.reason}`);
      return;
    }
    setAppliedPatch(pendingPatch);
    setPendingPatch(null);
    setStatus('AI patch applied.');
  };

  const askAi = () => {
    if (!baseVersion || !selectionRange || !selectionText) {
      setStatus('Select text before asking AI.');
      return;
    }
    setChatAnswer(`AI answer grounded in "${selectionText}".`);
    setChatCitation({
      type: 'doc',
      baseVersion,
      rangeFrom: selectionRange.from,
      rangeTo: selectionRange.to,
    });
    setStatus('AI answer includes a document citation.');
  };

  const jumpToCitation = (citation: Extract<EditPatchCitation, { type: 'doc' }>) => {
    if (!editor) return;
    const from = citation.rangeFrom + 1;
    const to = Math.max(from, citation.rangeTo + 1);
    editor.chain().focus().setTextSelection({ from, to }).run();
    setJumpTarget(currentText.slice(citation.rangeFrom, citation.rangeTo));
  };

  const visiblePatch = pendingPatch ?? appliedPatch;

  return (
    <section className="lash-ai-panel" data-testid="ai-panel" aria-label="AI editor">
      <div className="ai-panel-header">
        <h2 className="ai-panel-title">AI Editor</h2>
        <span className="ai-label" data-testid="ai-label">
          AI Editor
        </span>
      </div>

      <div className="ai-controls">
        <button
          type="button"
          className="ai-action-button"
          data-testid="ai-improve-button"
          disabled={!canRequestSelectionPatch}
          onClick={createSelectionPatch}
        >
          Improve Writing
        </button>
        <button
          type="button"
          className="ai-action-button"
          data-testid="ai-chat-ask"
          disabled={!canRequestSelectionPatch}
          onClick={askAi}
        >
          Ask AI
        </button>
        <button
          type="button"
          className="ai-action-button"
          data-testid="ai-run-invalid"
          disabled={!baseVersion}
          onClick={createInvalidPatch}
        >
          Test invalid patch
        </button>
      </div>

      <label className="ai-confirm-control">
        <input
          type="checkbox"
          data-testid="ai-global-confirm"
          checked={globalConfirmed}
          onChange={(event) => setGlobalConfirmed(event.currentTarget.checked)}
        />
        Confirm doc-wide edit
      </label>
      <button
        type="button"
        className="ai-action-button"
        data-testid="ai-global-rewrite"
        disabled={!baseVersion || !currentText}
        onClick={createGlobalPatch}
      >
        Rewrite document
      </button>

      <p className="ai-status" data-testid="ai-status" aria-live="polite">
        {status}
      </p>

      {visiblePatch ? (
        <div className="ai-review" data-testid="ai-review">
          <p className="ai-rationale" data-testid="ai-rationale">
            {visiblePatch.rationale}
          </p>
          <pre className="ai-patch-json" data-testid="ai-patch-json">
            {JSON.stringify(visiblePatch, null, 2)}
          </pre>
          {visiblePatch.citations?.map((citation, index) =>
            citation.type === 'doc' ? (
              <button
                key={`${citation.baseVersion}:${citation.rangeFrom}:${citation.rangeTo}:${index}`}
                type="button"
                className="ai-citation-button"
                data-testid="ai-citation"
                data-range-from={String(citation.rangeFrom)}
                data-range-to={String(citation.rangeTo)}
                onClick={() => jumpToCitation(citation)}
              >
                Doc citation {citation.rangeFrom}-{citation.rangeTo}
              </button>
            ) : null,
          )}
          {pendingPatch ? (
            <div className="ai-review-actions">
              <button
                type="button"
                className="ai-action-button"
                data-testid="ai-accept-button"
                onClick={acceptPatch}
              >
                Accept
              </button>
              <button
                type="button"
                className="ai-action-button"
                data-testid="ai-reject-button"
                onClick={() => {
                  setPendingPatch(null);
                  setStatus('AI patch rejected.');
                }}
              >
                Reject
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {fallbackPatch ? (
        <p className="ai-fallback" data-testid="ai-fallback">
          {fallbackPatch.rationale}
        </p>
      ) : null}

      {chatAnswer && chatCitation ? (
        <div className="ai-chat-answer" data-testid="ai-chat-answer">
          <p>{chatAnswer}</p>
          <button
            type="button"
            className="ai-citation-button"
            data-testid="ai-chat-citation"
            data-range-from={String(chatCitation.rangeFrom)}
            data-range-to={String(chatCitation.rangeTo)}
            onClick={() => jumpToCitation(chatCitation)}
          >
            Citation: {currentText.slice(chatCitation.rangeFrom, chatCitation.rangeTo)}
          </button>
        </div>
      ) : null}

      {jumpTarget ? (
        <span className="sr-only" data-testid="ai-citation-jump-target">
          {jumpTarget}
        </span>
      ) : null}
    </section>
  );
}
