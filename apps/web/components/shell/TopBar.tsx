/**
 * TopBar — sticky document chrome.
 *
 * Hosts a sidebar toggle (mobile), document title, autosave indicator,
 * collaborator avatar stack, focus/suggest toggles, share CTA, and the
 * right-rail toggle.
 *
 * Notes: this header lives *inside* the page-level `<main>` landmark, so
 * we deliberately do not claim `role="banner"` — that role is reserved for
 * top-of-page banners outside any main/section. We expose stable
 * `aria-label`s on toggles and lean on `aria-pressed` for state.
 */
'use client';

import type { Editor } from '@tiptap/core';
import type { MouseEvent, ReactNode } from 'react';

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
  // Both handlers receive the originating click event so callers can stash
  // `event.currentTarget` for later focus restoration when the drawer closes.
  onShareClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMobileSidebar?: (event: MouseEvent<HTMLButtonElement>) => void;
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
  onShareClick,
  onOpenMobileSidebar,
  extras,
}: TopBarProps) {
  return (
    <header className="lash-topbar" data-testid="lash-topbar">
      {onOpenMobileSidebar ? (
        <button
          type="button"
          className="lash-icon-btn lash-topbar-mobile-menu"
          aria-label="Open navigation menu"
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
          aria-label="Focus mode"
          aria-pressed={focusMode ? 'true' : 'false'}
          data-active={focusMode ? 'true' : 'false'}
          data-tooltip={focusMode ? 'Exit focus mode' : 'Focus mode'}
          onClick={onToggleFocusMode}
        >
          <Icon name={focusMode ? 'minimize' : 'maximize'} />
          {/* Visible label kept for legacy text-content selectors; aria-label
              above is what assistive tech actually announces. */}
          <span className="sr-only">{focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}</span>
        </button>

        <button
          type="button"
          className="lash-icon-btn"
          data-testid="suggest-mode-toggle"
          aria-label="Suggest mode"
          aria-pressed={suggestMode ? 'true' : 'false'}
          data-active={suggestMode ? 'true' : 'false'}
          data-tooltip={suggestMode ? 'Stop suggesting' : 'Suggest mode'}
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
          aria-label="Share document"
          aria-expanded={railOpen ? 'true' : 'false'}
          aria-controls="lash-rail"
          onClick={onShareClick}
        >
          <Icon name="share" />
          <span className="lash-share-button-label">Share</span>
        </button>
      </div>
    </header>
  );
}
