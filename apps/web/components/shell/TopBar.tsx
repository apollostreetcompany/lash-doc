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

export interface TopBarPeer {
  actorId: string;
  label: string;
}

// Deterministic tint per collaborator so a given person keeps a stable colour.
const PEER_TINTS: AvatarTint[] = ['coral', 'blue', 'green', 'violet', 'amber'];
const tintForActor = (actorId: string): AvatarTint => {
  let hash = 0;
  for (let i = 0; i < actorId.length; i += 1) hash = (hash * 31 + actorId.charCodeAt(i)) >>> 0;
  return PEER_TINTS[hash % PEER_TINTS.length];
};

export interface TopBarProps {
  editor: Editor | null;
  /** Live remote collaborators from realtime presence (empty when solo). */
  peers: TopBarPeer[];
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
  peers,
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

        {peers.length ? (
          <AvatarStack>
            {peers.map((peer) => (
              <Avatar
                key={peer.actorId}
                name={peer.label}
                tint={tintForActor(peer.actorId)}
                title={`${peer.label} · in this document`}
              />
            ))}
          </AvatarStack>
        ) : null}

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
