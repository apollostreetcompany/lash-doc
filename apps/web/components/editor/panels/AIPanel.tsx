'use client';

import { suggestFallback, validateEditPatch, type ValidatorOptions } from '@lash/ai';
import type { DocumentId, EditPatch, EditPatchCitation } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getAiSelection, isAiSelectionCurrent, type AiSelection } from '../../../lib/aiSelection';
import {
  getWritingModelAvailability,
  MAX_AI_QUESTION_LENGTH,
  MAX_AI_REVISION_LENGTH,
  MAX_AI_SELECTION_LENGTH,
  requestWritingModel,
  type WritingModelAvailability,
} from '../../../lib/browserWritingModel';

export interface AIPanelProps {
  editor: Editor | null;
  docId: DocumentId;
  baseVersion: string | null;
  currentText: string;
  schemaVersion: string;
  open?: boolean;
  revisionFocusRequest?: number;
  showTestControls?: boolean;
  onApplyPatch: (
    patch: EditPatch,
    selection: AiSelection,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

const AI_AUTHOR = { type: 'ai', id: 'ai-editor', label: 'AI Editor' } as const;
const SCHEMA_SUMMARY: ValidatorOptions['schemaSummary'] = { nodeTypes: [], markTypes: [] };
const DRAFT_CHANGED = 'The draft or selection changed. Select the passage and try again.';
const PREVIEW_SURROUNDING_LENGTH = 180;

type Citation = Extract<EditPatchCitation, { type: 'doc' }>;
interface Source {
  citation: Citation;
  selection: AiSelection;
}
interface Revision extends Source {
  patch: EditPatch;
  text: string;
  before: string;
  after: string;
  editing?: boolean;
}

function revisionContext(currentText: string, { from, to }: AiSelection['plaintextRange']) {
  const paragraphStart = from > 0 ? currentText.lastIndexOf('\n', from - 1) + 1 : 0;
  const nextBreak = currentText.indexOf('\n', to);
  const paragraphEnd = nextBreak === -1 ? currentText.length : nextBreak;
  const start = Math.max(paragraphStart, from - PREVIEW_SURROUNDING_LENGTH);
  const end = Math.min(paragraphEnd, to + PREVIEW_SURROUNDING_LENGTH);
  return {
    before: `${start > paragraphStart ? '…' : ''}${currentText.slice(start, from)}`,
    after: `${currentText.slice(to, end)}${end < paragraphEnd ? '…' : ''}`,
  };
}

export function AIPanel({
  editor,
  docId,
  baseVersion,
  currentText,
  schemaVersion,
  open = true,
  revisionFocusRequest,
  showTestControls = false,
  onApplyPatch,
}: AIPanelProps) {
  const request = useRef<AbortController | null>(null);
  const applying = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedRevision = useRef<number | undefined>(undefined);
  const [availability, setAvailability] = useState<WritingModelAvailability | null>(null);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [pendingRevision, setPendingRevision] = useState<Revision | null>(null);
  const [fixtureAppliedRevision, setFixtureAppliedRevision] = useState<Revision | null>(null);
  const [answer, setAnswer] = useState<(Source & { text: string }) | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [globalConfirmed, setGlobalConfirmed] = useState(false);
  const [jumpTarget, setJumpTarget] = useState('');

  useEffect(() => {
    if (!open || showTestControls) return;
    let current = true;
    void getWritingModelAvailability().then((result) => {
      if (current) setAvailability(result);
    });
    return () => {
      current = false;
    };
  }, [availabilityAttempt, open, showTestControls]);

  useEffect(() => {
    setBusy(applying.current);
    if (!showTestControls) {
      setPendingRevision(null);
      setAnswer(null);
      setStatus('');
    }
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [open, editor, docId, showTestControls, revisionFocusRequest]);

  const editorDoc = editor?.state.doc;
  const selectionFrom = editor?.state.selection.from;
  const selectionTo = editor?.state.selection.to;
  const selection = useMemo(() => {
    if (!open || !editorDoc || selectionFrom === selectionTo) return null;
    return getAiSelection(editor, currentText);
  }, [currentText, editor, editorDoc, open, selectionFrom, selectionTo]);
  const hasModel =
    showTestControls ||
    availability === 'available' ||
    availability === 'downloadable' ||
    availability === 'downloading';
  const canUseModel = Boolean(editor && baseVersion && hasModel);
  const selectionFits = Boolean(
    selection?.text.trim() && selection.text.length <= MAX_AI_SELECTION_LENGTH,
  );
  const canAsk = canUseModel && !busy && selectionFits;
  const canRevise = canAsk && selection?.canReplace;

  useEffect(() => {
    if (
      !open ||
      !canUseModel ||
      revisionFocusRequest === undefined ||
      lastFocusedRevision.current === revisionFocusRequest ||
      !promptRef.current
    )
      return;
    lastFocusedRevision.current = revisionFocusRequest;
    promptRef.current.focus({ preventScroll: true });
  }, [canUseModel, open, revisionFocusRequest]);

  if (!open) return null;

  const getSource = (selection: AiSelection, version: string): Source => ({
    selection,
    citation: {
      type: 'doc',
      baseVersion: version,
      rangeFrom: selection.plaintextRange.from,
      rangeTo: selection.plaintextRange.to,
    },
  });

  const validateRevision = (patch: EditPatch, source: AiSelection) =>
    validateEditPatch(patch, {
      baseDoc: { text: currentText },
      baseVersionHash: baseVersion ?? undefined,
      selection: patch.allowGlobal ? null : source.plaintextRange,
      schemaSummary: SCHEMA_SUMMARY,
      confirmations: { globalEditConfirmed: Boolean(patch.allowGlobal && globalConfirmed) },
    });

  const stageRevision = (source: Source, text: string, rationale: string, allowGlobal = false) => {
    const { citation, selection } = source;
    const { from, to } = selection.plaintextRange;
    const patch: EditPatch = {
      patchId: crypto.randomUUID(),
      docId,
      baseVersion: citation.baseVersion,
      schemaVersion,
      author: AI_AUTHOR,
      createdAt: new Date().toISOString(),
      operations: [{ op: 'replace_text', from, to, text }],
      rationale,
      citations: [citation],
      ...(allowGlobal ? { allowGlobal } : {}),
    };
    const result = validateRevision(patch, selection);
    if (!result.ok) {
      setPendingRevision(null);
      setFallback(suggestFallback(patch, result)?.rationale ?? null);
      setStatus(
        result.reason === 'doc-wide-without-confirm'
          ? 'Global edit requires confirmation.'
          : 'This revision couldn’t be applied safely.',
      );
      return;
    }
    setPendingRevision({
      ...source,
      patch,
      text,
      ...revisionContext(currentText, selection.plaintextRange),
    });
    setStatus(showTestControls ? 'AI patch ready for review.' : 'Review the proposed revision.');
  };

  const run = async (kind: 'revision' | 'question') => {
    if (!editor || !baseVersion || request.current || applying.current || !hasModel) return;
    const excerpt = getAiSelection(editor, currentText);
    if (!excerpt?.text.trim() || excerpt.text.length > MAX_AI_SELECTION_LENGTH) {
      setStatus(
        kind === 'revision'
          ? 'Select text before requesting an AI edit.'
          : 'Select text before asking AI.',
      );
      return;
    }
    if (kind === 'revision' && !excerpt.canReplace) {
      setStatus('Select text within a single paragraph or heading to revise it.');
      return;
    }
    const input = prompt.trim();
    if (kind === 'question' && !input && !showTestControls) return;

    const source = getSource(excerpt, baseVersion);
    setPendingRevision(null);
    setFixtureAppliedRevision(null);
    setFallback(null);
    setAnswer(null);
    if (showTestControls) {
      if (kind === 'revision') {
        stageRevision(
          source,
          `Polished ${excerpt.text}`,
          'Tighten the selected wording while preserving the original meaning.',
        );
      } else {
        setAnswer({ ...source, text: `AI answer grounded in "${excerpt.text}".` });
        setStatus('AI answer includes a document citation.');
      }
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const inProgress = kind === 'revision' ? 'Preparing a revision…' : 'Reading the excerpt…';
    setStatus(
      availability === 'available' ? inProgress : 'Preparing the browser’s on-device model…',
    );
    try {
      const { from, to } = excerpt.plaintextRange;
      const context = {
        selectedText: excerpt.text,
        beforeContext: currentText.slice(Math.max(0, from - MAX_AI_SELECTION_LENGTH), from),
        afterContext: currentText.slice(to, to + MAX_AI_SELECTION_LENGTH),
      };
      const response = await requestWritingModel(
        kind === 'revision'
          ? { ...context, kind, instruction: input || 'Make this clearer and more concise.' }
          : { ...context, kind, question: input },
        controller.signal,
        (progress) => {
          if (request.current !== controller || availability === 'available') return;
          setStatus(
            progress === 100 ? inProgress : `Downloading the on-device model (${progress}%)…`,
          );
        },
      );
      if (request.current !== controller || controller.signal.aborted) return;
      setAvailability('available');
      if (editor.isDestroyed || !isAiSelectionCurrent(editor, excerpt)) {
        setStatus(DRAFT_CHANGED);
        return;
      }
      if (response.kind === 'question') {
        setAnswer({ ...source, text: response.answer });
        setStatus('Answer ready.');
        return;
      }
      if (response.revision === excerpt.text.trim()) {
        setStatus('The model didn’t suggest a change to this selection.');
        return;
      }
      const leadingSpace = excerpt.text.match(/^\s*/u)?.[0] ?? '';
      const trailingSpace = excerpt.text.match(/\s*$/u)?.[0] ?? '';
      stageRevision(
        source,
        `${leadingSpace}${response.revision}${trailingSpace}`,
        response.rationale,
      );
    } catch {
      if (request.current === controller && !controller.signal.aborted) {
        setStatus(
          'The on-device model couldn’t complete this request. Try again with a shorter excerpt.',
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  const acceptRevision = async () => {
    if (!pendingRevision || applying.current) return;
    if (pendingRevision.patch.allowGlobal && !globalConfirmed) {
      setPendingRevision(null);
      setStatus('Global edit requires confirmation.');
      return;
    }
    if (
      !editor ||
      (!pendingRevision.patch.allowGlobal &&
        !isAiSelectionCurrent(editor, pendingRevision.selection))
    ) {
      setPendingRevision(null);
      setStatus(DRAFT_CHANGED);
      return;
    }
    const { text, selection: selectedSource } = pendingRevision;
    if (!text.trim() || text === selectedSource.text) return;
    const { from, to } = selectedSource.plaintextRange;
    const patch: EditPatch = {
      ...pendingRevision.patch,
      operations: [{ op: 'replace_text', from, to, text }],
    };
    if (!validateRevision(patch, selectedSource).ok) {
      setPendingRevision(null);
      setStatus(DRAFT_CHANGED);
      return;
    }
    applying.current = true;
    setBusy(true);
    try {
      const result = await onApplyPatch(patch, selectedSource);
      if (!result.ok) {
        setPendingRevision(null);
        setStatus(`Couldn’t apply the revision. ${result.reason}`);
        return;
      }
      if (showTestControls) setFixtureAppliedRevision(pendingRevision);
      setPendingRevision(null);
      setStatus(showTestControls ? 'AI patch applied.' : 'Revision applied.');
    } catch {
      setStatus('Couldn’t apply the revision. Check the draft before trying again.');
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };

  const jumpToSource = (source: Source) => {
    if (!editor) return;
    if (!showTestControls && editor.state.doc !== source.selection.document) {
      setStatus('The draft changed after this answer. Select the excerpt to ask again.');
      return;
    }
    const { from, to } = source.selection.pmRange;
    editor.chain().focus().setTextSelection({ from, to }).run();
    setJumpTarget(source.selection.text);
  };

  const visibleRevision = pendingRevision ?? fixtureAppliedRevision;
  const guidance = !hasModel
    ? availability === null
      ? 'Checking for an on-device model…'
      : availability === 'timed-out'
        ? 'The browser’s on-device model didn’t respond. You can keep editing your draft.'
        : 'On-device AI is unavailable in this browser. You can keep editing your draft.'
    : !editor || !baseVersion
      ? 'AI editing is unavailable for this document.'
      : !selection
        ? 'Select a passage in your draft to get started.'
        : !selectionFits
          ? `Select up to ${MAX_AI_SELECTION_LENGTH.toLocaleString('en-US')} characters of text.`
          : !selection.canReplace
            ? 'Select text within one paragraph or heading to preview a revision.'
            : '';

  return (
    <section className="lash-ai-panel" data-testid="ai-panel" aria-label="AI editor">
      {canUseModel && !showTestControls ? (
        <>
          <p className="ai-rationale">
            Your browser processes the selection and nearby text on this device.
            {availability !== 'available' ? ' It may need to download its model first.' : ''}
          </p>
          <label className="ai-prompt">
            <span>Revision instructions or question</span>
            <textarea
              ref={promptRef}
              data-testid="ai-prompt"
              rows={2}
              value={prompt}
              maxLength={MAX_AI_QUESTION_LENGTH}
              placeholder="Make this more direct"
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />
          </label>
        </>
      ) : null}
      {hasModel ? (
        <div className="ai-controls">
          <button
            type="button"
            className="ai-action-button"
            data-testid="ai-improve-button"
            disabled={!canRevise}
            onClick={() => void run('revision')}
          >
            Improve writing
          </button>
          <button
            type="button"
            className="ai-action-button"
            data-testid="ai-chat-ask"
            disabled={!canAsk || (!showTestControls && !prompt.trim())}
            onClick={() => void run('question')}
          >
            Ask about selection
          </button>
          {busy && !applying.current ? (
            <button
              type="button"
              className="ai-action-button"
              onClick={() => {
                request.current?.abort();
                request.current = null;
                setBusy(false);
                setStatus('Request canceled.');
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {showTestControls ? (
        <>
          <button
            type="button"
            className="ai-action-button"
            data-testid="ai-run-invalid"
            disabled={!baseVersion}
            onClick={() => {
              if (!baseVersion) return;
              const result = validateEditPatch(
                {
                  patchId: crypto.randomUUID(),
                  docId,
                  baseVersion,
                  schemaVersion,
                  author: AI_AUTHOR,
                  createdAt: new Date().toISOString(),
                  operations: [{ op: 'insert_node', pos: 0, node: { type: 'unknownWidget' } }],
                  rationale: 'Test an unsupported structure.',
                },
                {
                  baseDoc: { text: currentText },
                  selection: selection?.plaintextRange ?? null,
                  schemaSummary: SCHEMA_SUMMARY,
                  confirmations: {},
                },
              );
              setPendingRevision(null);
              if (!result.ok) setStatus(`AI patch rejected: ${result.details ?? result.reason}.`);
            }}
          >
            Test invalid patch
          </button>
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
            onClick={() => {
              if (!editor || !baseVersion) return;
              const whole = getAiSelection(editor, currentText, {
                from: 1,
                to: editor.state.doc.content.size - 1,
              });
              if (whole?.canReplace)
                stageRevision(
                  getSource(whole, baseVersion),
                  `Polished draft: ${currentText}`,
                  'Rewrite the full document only after explicit user confirmation.',
                  true,
                );
            }}
          >
            Rewrite document
          </button>
        </>
      ) : null}

      <p
        className="ai-status"
        data-testid="ai-status"
        aria-live="polite"
        hidden={!status && !guidance}
      >
        {status || guidance}
      </p>
      {availability === 'timed-out' ? (
        <button
          type="button"
          className="ai-action-button"
          onClick={() => {
            setAvailability(null);
            setAvailabilityAttempt((attempt) => attempt + 1);
          }}
        >
          Check again
        </button>
      ) : null}
      {visibleRevision ? (
        <div className="ai-review" data-testid="ai-review">
          {!showTestControls ? (
            <dl className="ai-revision-comparison">
              <div>
                <dt>Original</dt>
                <dd data-testid="ai-original">{visibleRevision.selection.text}</dd>
              </div>
              <div>
                <dt>Proposed revision</dt>
                <dd>
                  {visibleRevision.editing ? (
                    <input
                      className="ai-revision-input"
                      data-testid="ai-revision-input"
                      aria-label="Proposed wording"
                      autoFocus
                      value={visibleRevision.text}
                      maxLength={MAX_AI_REVISION_LENGTH}
                      disabled={busy}
                      onChange={(event) => {
                        const text = event.currentTarget.value;
                        setPendingRevision((draft) => draft && { ...draft, text });
                      }}
                    />
                  ) : (
                    <>
                      <span data-testid="ai-revision">{visibleRevision.text}</span>
                      <button
                        type="button"
                        className="ai-action-button ai-edit-revision"
                        data-testid="ai-edit-revision"
                        disabled={busy}
                        onClick={() =>
                          setPendingRevision((draft) => draft && { ...draft, editing: true })
                        }
                      >
                        Edit wording
                      </button>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>In your draft</dt>
                <dd data-testid="ai-revision-context">
                  {visibleRevision.before}
                  <mark>{visibleRevision.text}</mark>
                  {visibleRevision.after}
                </dd>
              </div>
            </dl>
          ) : null}
          <p className="ai-rationale" data-testid="ai-rationale">
            {visibleRevision.patch.rationale}
          </p>
          {showTestControls ? (
            <>
              <pre className="ai-patch-json" data-testid="ai-patch-json">
                {JSON.stringify(visibleRevision.patch, null, 2)}
              </pre>
              <button
                type="button"
                className="ai-citation-button"
                data-testid="ai-citation"
                data-range-from={visibleRevision.citation.rangeFrom}
                data-range-to={visibleRevision.citation.rangeTo}
                onClick={() => jumpToSource(visibleRevision)}
              >
                Doc citation {visibleRevision.citation.rangeFrom}-{visibleRevision.citation.rangeTo}
              </button>
            </>
          ) : null}
          {pendingRevision ? (
            <div className="ai-review-actions">
              <button
                type="button"
                className="ai-action-button"
                data-testid="ai-accept-button"
                disabled={
                  busy ||
                  !pendingRevision.text.trim() ||
                  pendingRevision.text === pendingRevision.selection.text
                }
                onClick={() => void acceptRevision()}
              >
                {showTestControls ? 'Accept' : 'Apply revision'}
              </button>
              <button
                type="button"
                className="ai-action-button"
                data-testid="ai-reject-button"
                disabled={busy}
                onClick={() => {
                  setPendingRevision(null);
                  setStatus(showTestControls ? 'AI patch rejected.' : 'Revision discarded.');
                }}
              >
                {showTestControls ? 'Reject' : 'Discard'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {fallback ? (
        <p className="ai-fallback" data-testid="ai-fallback">
          {fallback}
        </p>
      ) : null}
      {answer ? (
        <div className="ai-chat-answer" data-testid="ai-chat-answer">
          <p>{answer.text}</p>
          <button
            type="button"
            className="ai-citation-button"
            data-testid="ai-chat-citation"
            data-range-from={answer.citation.rangeFrom}
            data-range-to={answer.citation.rangeTo}
            onClick={() => jumpToSource(answer)}
          >
            {showTestControls ? `Citation: ${answer.selection.text}` : 'Go to source excerpt'}
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
