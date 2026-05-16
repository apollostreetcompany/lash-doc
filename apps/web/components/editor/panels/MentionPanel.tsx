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

const context = {
  callerId: 'local-user',
  locale: 'en-US',
  timezone: 'Asia/Tokyo',
  now: '2026-05-16T00:00:00.000Z',
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

export function MentionPanel({ editor, currentText }: MentionPanelProps) {
  const [suggestions, setSuggestions] = useState<
    Extract<MentionResolveResult, { visible: true }>[]
  >([]);
  const [anonymized, setAnonymized] = useState<Extract<MentionResolveResult, { visible: false }>[]>(
    [],
  );
  const [chips, setChips] = useState<Extract<MentionResolveResult, { visible: true }>[]>([]);

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
      return;
    }

    let disposed = false;
    const query = match[1].trim();
    const date = parseDateMention(query, context);
    if (date?.visible) {
      setSuggestions([date]);
      setAnonymized([]);
      return;
    }

    Promise.all([
      providers.user.resolve(query, context),
      providers.group.resolve(query, context),
    ]).then((results) => {
      if (disposed) return;
      const flattened = results.flat();
      setSuggestions(visibleMentions(flattened));
      setAnonymized(hiddenMentions(flattened));
    });

    return () => {
      disposed = true;
    };
  }, [currentText, providers]);

  const insertMention = (mention: Extract<MentionResolveResult, { visible: true }>) => {
    setChips((items) => [...items, mention]);
    editor?.chain().focus().insertContent(` ${mention.display} `).run();
  };

  return (
    <section className="lash-mention-panel" data-testid="mention-panel" aria-label="Mentions">
      <div className="mention-suggestions" data-testid="mention-suggestions">
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
