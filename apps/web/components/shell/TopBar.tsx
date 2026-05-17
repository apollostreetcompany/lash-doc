/**
 * TopBar — sticky document chrome.
 *
 * Hosts a sidebar toggle (mobile), document title, autosave indicator,
 * collaborator avatar stack, focus/suggest toggles, share CTA, and the
 * right-rail toggle.
 */
'use client';

import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';


import { Avatar, AvatarStack, type AvatarTint } from './Avatar';
import { Icon } from './Icon';
import { AutosaveIndicator } from '../editor/panels/AutosaveIndicator';

interface Collaborator {
  name: string;
  tint: AvatarTint;
}

const PRESENT_COLLABORATORS: Collaborator[] = [
  { name: 'Apollo', tint: 'coral' },
  { name: 'Ada Lovelace', tint: 'blue' },
  { name: 'Grace Hopper', tint: 'green' },
];

export interface TopBarProps {
  editor: Editor | null;
  docTitle: string;
  focusMode: boolean;
  suggestMode: boolean;
  railOpen: boolean;
  onToggleFocusMode: () => void;
  onToggleSuggestMode: () => void;
  onToggleRail: () => void;
  onOpenMobileSidebar?: () => void;
  extras?: ReactNode;
}

export function TopBar({
  editor,
  docTitle,
  focusMode,
  suggestMode,
  railOpen,
  onToggleFocusMode,
  onToggleSuggestMode,
  onToggleRail,
  onOpenMobileSidebar,
  extras,
}: TopBarProps) {
  return (
    <header className="lash-topbar" data-testid="lash-topbar" role="banner">
      {onOpenMobileSidebar ? (
        <button
          type="button"
          className="lash-icon-btn"
          aria-label="Open menu"
          onClick={onOpenMobileSidebar}
          data-testid="topbar-mobile-menu"
        >
          <Icon name="menu" />
        </button>
      ) : null}

      <div className="lash-topbar-doc">
        <Icon name="document" className="lash-topbar-doc-icon" />
        <span className="lash-topbar-title" data-testid="topbar-doc-title">
          {docTitle}
        </span>
        <span className="lash-topbar-saved">
          <AutosaveIndicator editor={editor} />
        </span>
      </div>

      <div className="lash-topbar-actions">
        {extras}

        <button
          type="button"
          className="lash-icon-btn"
          data-testid="focus-mode-toggle"
          aria-pressed={focusMode ? 'true' : 'false'}
          data-active={focusMode ? 'true' : 'false'}
          data-tooltip={focusMode ? 'Exit focus' : 'Focus mode'}
          onClick={onToggleFocusMode}
        >
          <Icon name={focusMode ? 'minimize' : 'maximize'} />
          <span className="sr-only">{focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}</span>
        </button>

        <button
          type="button"
          className="lash-icon-btn"
          data-testid="suggest-mode-toggle"
          aria-pressed={suggestMode ? 'true' : 'false'}
          data-active={suggestMode ? 'true' : 'false'}
          data-tooltip={suggestMode ? 'Suggesting' : 'Suggest mode'}
          onClick={onToggleSuggestMode}
        >
          <Icon name="pencil" />
          <span className="sr-only">{suggestMode ? 'Suggesting' : 'Suggest'}</span>
        </button>

        <AvatarStack>
          {PRESENT_COLLABORATORS.map((collaborator) => (
            <Avatar
              key={collaborator.name}
              name={collaborator.name}
              tint={collaborator.tint}
              title={`${collaborator.name} · viewing now`}
            />
          ))}
        </AvatarStack>

        <button
          type="button"
          className="lash-share-button"
          data-testid="topbar-share-button"
          onClick={onToggleRail}
          aria-expanded={railOpen ? 'true' : 'false'}
        >
          <Icon name="share" />
          <span className="lash-share-button-label">Share</span>
        </button>
      </div>
    </header>
  );
}
