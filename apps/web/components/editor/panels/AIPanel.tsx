'use client';

import { suggestFallback, validateEditPatch, type ValidatorOptions } from '@lash/ai';
import type { DocumentId, EditPatch, EditPatchCitation } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getAiSelection, isAiSelectionCurrent, type AiSelection } from '../../../lib/aiSelection';
import {
  canUseWritingModel,
  checkWritingModelAvailability,
  InvalidWritingModelResponseError,
  markWritingModelAvailable,
  MAX_AI_QUESTION_LENGTH,
  MAX_AI_REVISION_LENGTH,
  MAX_AI_SELECTION_LENGTH,
  requestWritingModel,
  useWritingModelAvailability,
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
  requestDocumentNavigation?: (navigateToTarget: () => boolean) => void;
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

type Activity =
  | { phase: 'idle' }
  | { phase: 'generating'; controller: AbortController }
  | { phase: 'applying'; visit: symbol };

type PanelResult = (
  | { kind: 'notice' }
  | { kind: 'revision' | 'fixture-applied'; revision: Revision }
  | { kind: 'answer'; answer: Source & { text: string } }
  | { kind: 'fallback'; rationale: string }
  | { kind: 'model-failure'; source: Source }
) & { status: string; jumpTarget?: string };

const IDLE = { phase: 'idle' } as const;
const NO_RESULT = { kind: 'notice', status: '' } as const;

function focusSource(editor: Editor, source: Source) {
  return editor.chain().focus().setTextSelection(source.selection.pmRange).run();
}

function canFocusSource({ selection: { document, pmRange } }: Source) {
  return (
    document.resolve(pmRange.from).parent.inlineContent &&
    document.resolve(pmRange.to).parent.inlineContent
  );
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
  requestDocumentNavigation,
  onApplyPatch,
}: AIPanelProps) {
  // Read the owner synchronously in event handlers. React renders only its phase.
  const operation = useRef<Activity>(IDLE);
  const panelVisit = useRef<symbol | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedRevision = useRef<number | undefined>(undefined);
  const availability = useWritingModelAvailability(open && !showTestControls, {
    refreshOnSubscribe: true,
  });
  const [panelResult, setPanelResult] = useState<PanelResult>(NO_RESULT);
  const [activity, setActivity] = useState<Activity['phase']>('idle');
  const [prompt, setPrompt] = useState('');
  const [globalConfirmed, setGlobalConfirmed] = useState(false);

  const hasActiveOperation = () => operation.current.phase !== 'idle';
  const transition = (next: Activity) => {
    operation.current = next;
    setActivity(next.phase);
  };
  const setStatus = (status: string) => setPanelResult((current) => ({ ...current, status }));

  useLayoutEffect(() => {
    panelVisit.current = Symbol();
    setActivity(operation.current.phase);
    if (!showTestControls || operation.current.phase === 'applying') setPanelResult(NO_RESULT);
    return () => {
      panelVisit.current = null;
      const running = operation.current;
      if (running.phase === 'generating') {
        operation.current = IDLE;
        running.controller.abort();
      }
      // A document write already in progress keeps its lock until it settles.
    };
  }, [open, editor, docId, showTestControls, revisionFocusRequest]);

  const editorDoc = editor?.state.doc;
  const selectionFrom = editor?.state.selection.from;
  const selectionTo = editor?.state.selection.to;
  const selection = useMemo(() => {
    if (!open || !editorDoc || selectionFrom === selectionTo) return null;
    return getAiSelection(editor, currentText);
  }, [currentText, editor, editorDoc, open, selectionFrom, selectionTo]);
  const hasModel = showTestControls || canUseWritingModel(availability);
  const canUseModel = Boolean(editor && baseVersion && hasModel);
  const selectionFits = Boolean(
    selection?.text.trim() && selection.text.length <= MAX_AI_SELECTION_LENGTH,
  );
  const busy = activity !== 'idle';
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
      const rationale = suggestFallback(patch, result)?.rationale;
      const status =
        result.reason === 'doc-wide-without-confirm'
          ? 'Global edit requires confirmation.'
          : 'This revision couldn’t be applied safely.';
      setPanelResult(
        rationale ? { kind: 'fallback', rationale, status } : { kind: 'notice', status },
      );
      return;
    }
    setPanelResult({
      kind: 'revision',
      status: showTestControls ? 'AI patch ready for review.' : 'Review the proposed revision.',
      revision: {
        ...source,
        patch,
        text,
        ...revisionContext(currentText, selection.plaintextRange),
      },
    });
  };

  const run = async (kind: 'revision' | 'question') => {
    if (!editor || !baseVersion || hasActiveOperation() || !hasModel) return;
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
    if (showTestControls) {
      if (kind === 'revision') {
        stageRevision(
          source,
          `Polished ${excerpt.text}`,
          'Tighten the selected wording while preserving the original meaning.',
        );
      } else {
        setPanelResult({
          kind: 'answer',
          answer: { ...source, text: `AI answer grounded in "${excerpt.text}".` },
          status: 'AI answer includes a document citation.',
        });
      }
      return;
    }

    const controller = new AbortController();
    const generation = { phase: 'generating', controller } as const;
    transition(generation);
    const inProgress = kind === 'revision' ? 'Preparing a revision…' : 'Reading the excerpt…';
    setPanelResult({
      kind: 'notice',
      status:
        availability === 'available' ? inProgress : 'Preparing the browser’s on-device model…',
    });
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
          if (operation.current !== generation || availability === 'available') return;
          setStatus(
            progress === 100 ? inProgress : `Downloading the on-device model (${progress}%)…`,
          );
        },
      );
      if (operation.current !== generation || controller.signal.aborted) return;
      // Successful inference is stronger evidence than the outstanding capability check.
      markWritingModelAvailable();
      if (editor.isDestroyed || !isAiSelectionCurrent(editor, excerpt)) {
        setStatus(DRAFT_CHANGED);
        return;
      }
      if (response.kind === 'question') {
        setPanelResult({
          kind: 'answer',
          answer: { ...source, text: response.answer },
          status: 'Answer ready.',
        });
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
    } catch (error) {
      if (operation.current === generation && !controller.signal.aborted) {
        setPanelResult({
          kind: 'model-failure',
          source,
          status:
            error instanceof InvalidWritingModelResponseError
              ? 'The on-device model returned a reply Lash couldn’t use. Your draft is unchanged.'
              : 'The on-device model couldn’t complete this request. Your draft is unchanged.',
        });
      }
    } finally {
      if (operation.current === generation) transition(IDLE);
    }
  };

  const pendingRevision = panelResult.kind === 'revision' ? panelResult.revision : null;

  const acceptRevision = async () => {
    if (!pendingRevision || hasActiveOperation() || !panelVisit.current) return;
    if (pendingRevision.patch.allowGlobal && !globalConfirmed) {
      setPanelResult({ kind: 'notice', status: 'Global edit requires confirmation.' });
      return;
    }
    if (
      !editor ||
      (!pendingRevision.patch.allowGlobal &&
        !isAiSelectionCurrent(editor, pendingRevision.selection))
    ) {
      setPanelResult({ kind: 'notice', status: DRAFT_CHANGED });
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
      setPanelResult({ kind: 'notice', status: DRAFT_CHANGED });
      return;
    }
    const apply = { phase: 'applying', visit: panelVisit.current } as const;
    transition(apply);
    try {
      const result = await onApplyPatch(patch, selectedSource);
      if (panelVisit.current !== apply.visit) return;
      if (!result.ok) {
        setPanelResult({ kind: 'notice', status: `Couldn’t apply the revision. ${result.reason}` });
        return;
      }
      setPanelResult(
        showTestControls
          ? { kind: 'fixture-applied', revision: pendingRevision, status: 'AI patch applied.' }
          : { kind: 'notice', status: 'Revision applied.' },
      );
    } catch {
      if (panelVisit.current === apply.visit) {
        setStatus('Couldn’t apply the revision. Check the draft before trying again.');
      }
    } finally {
      if (panelVisit.current === null) operation.current = IDLE;
      else transition(IDLE);
    }
  };

  const jumpToSource = (source: Source) => {
    if (!editor) return;
    if (!showTestControls && editor.state.doc !== source.selection.document) {
      setStatus('The draft changed after this answer. Select the excerpt to ask again.');
      return;
    }
    focusSource(editor, source);
    setPanelResult((current) => ({ ...current, jumpTarget: source.selection.text }));
  };

  const returnToSource = (source: Source) => {
    if (!editor) return;
    const canReturn = () =>
      !editor.isDestroyed && editor.isEditable && editor.state.doc === source.selection.document;
    if (!canReturn()) {
      setStatus(
        'The draft changed or is no longer editable. Select the passage again to continue.',
      );
      return;
    }
    // On phones the original draft can change while the drawer closes.
    const navigate = () => canReturn() && focusSource(editor, source);
    if (requestDocumentNavigation) requestDocumentNavigation(navigate);
    else navigate();
  };

  const visibleRevision =
    pendingRevision ?? (panelResult.kind === 'fixture-applied' ? panelResult.revision : null);
  const answer = panelResult.kind === 'answer' ? panelResult.answer : null;
  const { status, jumpTarget } = panelResult;
  const guidance = !hasModel
    ? availability === 'checking'
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
      {hasModel || activity === 'generating' ? (
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
          {activity === 'generating' ? (
            <button
              type="button"
              className="ai-action-button"
              onClick={() => {
                const running = operation.current;
                if (running.phase !== 'generating') return;
                transition(IDLE);
                running.controller.abort();
                setPanelResult({ kind: 'notice', status: 'Request canceled.' });
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
            disabled={busy || !baseVersion}
            onClick={() => {
              if (!baseVersion || hasActiveOperation()) return;
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
              setPanelResult(
                result.ok
                  ? NO_RESULT
                  : {
                      kind: 'notice',
                      status: `AI patch rejected: ${result.details ?? result.reason}.`,
                    },
              );
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
            disabled={busy || !baseVersion || !currentText}
            onClick={() => {
              if (!editor || !baseVersion || hasActiveOperation()) return;
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
      {panelResult.kind === 'model-failure' && editor && canFocusSource(panelResult.source) ? (
        <button
          type="button"
          className="ai-action-button"
          onClick={() => returnToSource(panelResult.source)}
        >
          Return to selected passage
        </button>
      ) : null}
      {availability === 'timed-out' ? (
        <button type="button" className="ai-action-button" onClick={checkWritingModelAvailability}>
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
                        setPanelResult((current) =>
                          current.kind === 'revision'
                            ? {
                                ...current,
                                revision: { ...current.revision, text },
                              }
                            : current,
                        );
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
                          setPanelResult((current) =>
                            current.kind === 'revision'
                              ? {
                                  ...current,
                                  revision: { ...current.revision, editing: true },
                                }
                              : current,
                          )
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
                  setPanelResult({
                    kind: 'notice',
                    status: showTestControls ? 'AI patch rejected.' : 'Revision discarded.',
                  });
                }}
              >
                {showTestControls ? 'Reject' : 'Discard'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {panelResult.kind === 'fallback' ? (
        <p className="ai-fallback" data-testid="ai-fallback">
          {panelResult.rationale}
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
