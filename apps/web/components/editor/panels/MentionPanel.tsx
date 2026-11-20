/**
 * panels/MentionPanel — local @mentions suggestions and chips.
 */
'use client';

import {
  createGroupMentionProvider,
  createUserMentionProvider,
  parseDateMention,
} from '@lash/mentions';
import { createPolicyEngine } from '@lash/rbac';
import type {
  AnonymizedMentionResult,
  MentionResolveResult,
  VisibleMentionResult,
} from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';

export interface MentionPanelProps {
  editor: Editor | null;
  currentText: string;
}

/**
 * Resolve the mention context from the runtime environment. Locale and timezone
 * are derived from the browser so date suggestions reflect the user's real zone;
 * `now` is intentionally omitted so parseDateMention falls back to new Date().
 * Falls back to safe defaults when Intl/navigator are unavailable (e.g. SSR).
 */
const resolveMentionContext = () => {
  let locale = 'en-US';
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    // Intl unavailable — keep the UTC fallback.
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    locale = navigator.language;
  }
  return { callerId: 'local-user', locale, timezone };
};

type MentionLookup =
  | { kind: 'idle' }
  | { kind: 'loading' | 'error'; trigger: string }
  | {
      kind: 'ready';
      trigger: string;
      suggestions: VisibleMentionResult[];
      anonymized: AnonymizedMentionResult[];
    };

const readyLookup = (trigger: string, mentions: MentionResolveResult[]): MentionLookup => ({
  kind: 'ready',
  trigger,
  suggestions: mentions.filter((mention): mention is VisibleMentionResult => mention.visible),
  anonymized: mentions.filter((mention): mention is AnonymizedMentionResult => !mention.visible),
});

const activeTrigger = (text: string) => text.match(/@([^@\n]{1,40})$/)?.[0] ?? null;

export function MentionPanel({ editor, currentText }: MentionPanelProps) {
  const [lookup, setLookup] = useState<MentionLookup>({ kind: 'idle' });
  const [chips, setChips] = useState<VisibleMentionResult[]>([]);
  const trigger = activeTrigger(currentText);

  const context = useMemo(() => resolveMentionContext(), []);

  const providers = useMemo(() => {
    const policy = createPolicyEngine({
      revocations: { isRevoked: async () => false },
      visibility: {
        canSee: async (_userId, target) =>
          target.kind !== 'doc' && !target.refId.toLowerCase().includes('secret'),
      },
    });
    return {
      user: createUserMentionProvider({
        policy,
        users: {
          search: async (query) =>
            'ada lovelace'.includes(query.toLowerCase())
              ? [{ id: 'user:ada', displayName: 'Ada Lovelace' }]
              : [],
        },
      }),
      group: createGroupMentionProvider({
        policy,
        groups: {
          search: async (query) =>
            ['design team', 'secret group']
              .filter((name) => name.includes(query.toLowerCase()))
              .map((name) => ({
                id: name.includes('secret') ? 'group:secret' : 'group:design',
                displayName: name === 'design team' ? 'Design Team' : 'Secret Group',
              })),
        },
      }),
    };
  }, []);

  useEffect(() => {
    if (!trigger) {
      setLookup({ kind: 'idle' });
      return;
    }

    const query = trigger.slice(1).trim();
    const date = parseDateMention(query, context);
    if (date?.visible) {
      setLookup(readyLookup(trigger, [date]));
      return;
    }

    let disposed = false;
    setLookup({ kind: 'loading', trigger });
    Promise.all([providers.user.resolve(query, context), providers.group.resolve(query, context)])
      .then((results) => {
        if (!disposed) setLookup(readyLookup(trigger, results.flat()));
      })
      .catch((error) => {
        if (disposed) return;
        console.error('Mention provider resolution failed', error);
        setLookup({ kind: 'error', trigger });
      });

    return () => {
      disposed = true;
    };
  }, [trigger, context, providers]);

  const current = lookup.kind !== 'idle' && lookup.trigger === trigger ? lookup : null;

  const insertMention = (mention: VisibleMentionResult) => {
    if (!editor?.isEditable || !trigger || current?.kind !== 'ready') return;
    const { doc, selection } = editor.state;
    const { $from } = selection;
    const to = $from.pos;
    const from = to - trigger.length;
    if (
      !selection.empty ||
      !$from.parent.isTextblock ||
      $from.parentOffset < trigger.length ||
      doc.textBetween(from, to, '\n', '\uFFFC') !== trigger
    )
      return;

    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, [
        {
          type: 'mention',
          attrs: {
            kind: mention.kind,
            refId: mention.refId,
            display: mention.display,
            iso: mention.iso ?? null,
          },
        },
        { type: 'text', text: ' ' },
      ])
      .run();
    if (editor.state.doc !== doc) setChips((items) => [...items, mention]);
  };

  return (
    <section className="lash-mention-panel" data-testid="mention-panel" aria-label="Mentions">
      <div className="mention-suggestions" data-testid="mention-suggestions">
        {current?.kind === 'loading' && (
          <span className="mention-status" data-testid="mention-loading" role="status">
            Searching…
          </span>
        )}
        {current?.kind === 'error' && (
          <span className="mention-status mention-error" data-testid="mention-error" role="alert">
            Couldn’t load mentions. Please try again.
          </span>
        )}
        {current?.kind === 'ready' &&
          current.suggestions.length === 0 &&
          current.anonymized.length === 0 && (
            <span className="mention-status" data-testid="mention-empty">
              No people or groups found
            </span>
          )}
        {current?.kind === 'ready' &&
          current.suggestions.map((mention) => (
            <button
              key={`${mention.kind}:${mention.refId}`}
              type="button"
              className="mention-suggestion"
              data-testid="mention-suggestion"
              data-kind={mention.kind}
              onClick={() => insertMention(mention)}
            >
              {mention.display}
            </button>
          ))}
        {current?.kind === 'ready' &&
          current.anonymized.map((mention) => (
            <span
              key={mention.anonymizedDisplay}
              className="mention-anonymized"
              data-testid="mention-anonymized"
            >
              {mention.anonymizedDisplay}
            </span>
          ))}
      </div>
      <div className="mention-chip-list" data-testid="mention-chip-list">
        {chips.map((mention, index) => (
          <span
            key={`${mention.kind}:${mention.refId}:${index}`}
            className="mention-chip"
            data-testid="mention-chip"
            data-kind={mention.kind}
            title={mention.iso ?? mention.display}
          >
            {mention.display}
          </span>
        ))}
      </div>
    </section>
  );
}
