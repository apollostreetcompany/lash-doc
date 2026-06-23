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
import type { MentionResolveResult } from '@lash/types';
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

const visibleMentions = (
  mentions: MentionResolveResult[],
): Extract<MentionResolveResult, { visible: true }>[] =>
  mentions.filter((mention): mention is Extract<MentionResolveResult, { visible: true }> =>
    Boolean(mention.visible),
  );

const hiddenMentions = (
  mentions: MentionResolveResult[],
): Extract<MentionResolveResult, { visible: false }>[] =>
  mentions.filter(
    (mention): mention is Extract<MentionResolveResult, { visible: false }> => !mention.visible,
  );

const activeTrigger = (text: string) => text.match(/@([^@\n]{1,40})$/)?.[0] ?? null;

export function MentionPanel({ editor, currentText }: MentionPanelProps) {
  const [suggestions, setSuggestions] = useState<
    Extract<MentionResolveResult, { visible: true }>[]
  >([]);
  const [anonymized, setAnonymized] = useState<Extract<MentionResolveResult, { visible: false }>[]>(
    [],
  );
  const [chips, setChips] = useState<Extract<MentionResolveResult, { visible: true }>[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

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
    const match = currentText.match(/@([^@\n]{1,40})$/);
    if (!match) {
      setSuggestions([]);
      setAnonymized([]);
      setStatus('idle');
      return;
    }

    let disposed = false;
    const query = match[1].trim();
    const date = parseDateMention(query, context);
    if (date?.visible) {
      setSuggestions([date]);
      setAnonymized([]);
      setStatus('ready');
      return;
    }

    setStatus('loading');
    Promise.all([providers.user.resolve(query, context), providers.group.resolve(query, context)])
      .then((results) => {
        if (disposed) return;
        const flattened = results.flat();
        setSuggestions(visibleMentions(flattened));
        setAnonymized(hiddenMentions(flattened));
        setStatus('ready');
      })
      .catch((error) => {
        if (disposed) return;
        // Surface the failure instead of leaving a silent empty render or an
        // unhandled promise rejection.
        console.error('Mention provider resolution failed', error);
        setSuggestions([]);
        setAnonymized([]);
        setStatus('error');
      });

    return () => {
      disposed = true;
    };
  }, [currentText, context, providers]);

  const insertMention = (mention: Extract<MentionResolveResult, { visible: true }>) => {
    setChips((items) => [...items, mention]);
    if (!editor) return;

    const trigger = activeTrigger(currentText);
    const to = editor.state.selection.from;
    const from = trigger ? Math.max(1, to - trigger.length) : to;
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent([
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
  };

  return (
    <section className="lash-mention-panel" data-testid="mention-panel" aria-label="Mentions">
      <div className="mention-suggestions" data-testid="mention-suggestions">
        {status === 'loading' && (
          <span className="mention-status" data-testid="mention-loading" role="status">
            Searching…
          </span>
        )}
        {status === 'error' && (
          <span className="mention-status mention-error" data-testid="mention-error" role="alert">
            Couldn’t load mentions. Please try again.
          </span>
        )}
        {status === 'ready' && suggestions.length === 0 && anonymized.length === 0 && (
          <span className="mention-status" data-testid="mention-empty">
            No people or groups found
          </span>
        )}
        {suggestions.map((mention) => (
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
        {anonymized.map((mention) => (
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
