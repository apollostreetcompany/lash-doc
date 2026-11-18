/**
 * TopBar — sticky document chrome.
 *
 * Hosts document navigation, focus and suggestion controls, and sharing.
 *
 * Notes: this header lives *inside* the page-level `<main>` landmark, so
 * we deliberately do not claim `role="banner"` — that role is reserved for
 * top-of-page banners outside any main/section. We expose stable
 * `aria-label`s on toggles and lean on `aria-pressed` for state.
 */
'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { Icon } from './Icon';

export interface TopBarProps {
  focusMode: boolean;
  suggestionAvailable?: boolean;
  /** Whether the mobile navigation disclosure is currently visible. */
  mobileSidebarExpanded: boolean;
  /** Whether Share's runtime-specific surface is currently visible. */
  shareExpanded: boolean;
  /** Whether the owner-only Document settings surface is visible. */
  settingsExpanded?: boolean;
  /** Whether the activity rail is present in the DOM. */
  shareControlsPresent: boolean;
  /** The surface opened by Share; omitted controls stay absent until it exists. */
  shareControlsId?: 'lash-rail' | 'lash-owner-share-dialog';
  /** Popup semantics for Share when it opens the owner dialog. */
  shareHasPopup?: 'dialog';
  /** Whether the viewport-specific Discussion disclosure should be rendered. */
  mobileDiscussionVisible?: boolean;
  /** Whether Discussion currently owns the visible activity surface. */
  discussionExpanded?: boolean;
  onToggleFocusMode: () => void;
  onStartSuggestion?: (trigger: HTMLButtonElement) => void;
  // Rail-opening handlers receive the originating click event so callers can stash
  // `event.currentTarget` for later focus restoration when the drawer closes.
  onShareClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onSettingsClick?: (trigger: HTMLButtonElement) => void;
  onDiscussionClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMobileSidebar?: (event: MouseEvent<HTMLButtonElement>) => void;
  extras?: ReactNode;
}

export function TopBar({
  focusMode,
  suggestionAvailable = false,
  mobileSidebarExpanded,
  shareExpanded,
  settingsExpanded = false,
  shareControlsPresent,
  shareControlsId = 'lash-rail',
  shareHasPopup,
  mobileDiscussionVisible = false,
  discussionExpanded = false,
  onToggleFocusMode,
  onStartSuggestion,
  onShareClick,
  onSettingsClick,
  onDiscussionClick,
  onOpenMobileSidebar,
  extras,
}: TopBarProps) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileToolsPanelRef = useRef<HTMLDivElement | null>(null);

  const closeMobileTools = useCallback((restoreFocus: boolean) => {
    setMobileToolsOpen(false);
    if (restoreFocus) mobileToolsTriggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!mobileToolsOpen) return;
    mobileToolsPanelRef.current
      ?.querySelector<HTMLButtonElement>('button:not([disabled])')
      ?.focus({ preventScroll: true });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        mobileToolsTriggerRef.current?.contains(target) ||
        mobileToolsPanelRef.current?.contains(target)
      ) {
        return;
      }
      closeMobileTools(true);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMobileTools(true);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMobileTools, mobileToolsOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 431px)');
    const handleChange = () => {
      if (!media.matches) setMobileToolsOpen(false);
    };
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, []);

  return (
    <header className="lash-topbar" data-testid="lash-topbar">
      {onOpenMobileSidebar ? (
        <button
          type="button"
          className="lash-icon-btn lash-topbar-mobile-menu"
          aria-label="Open navigation menu"
          aria-expanded={mobileSidebarExpanded ? 'true' : 'false'}
          aria-controls="lash-sidebar"
          onClick={onOpenMobileSidebar}
          data-testid="topbar-mobile-menu"
        >
          <Icon name="menu" />
        </button>
      ) : null}

      <div className="lash-topbar-actions">
        {extras}

        <button
          type="button"
          className="lash-icon-btn lash-topbar-focus-action"
          data-testid="focus-mode-toggle"
          aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
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

        {onSettingsClick ? (
          <button
            type="button"
            className="lash-icon-btn lash-document-settings-button"
            data-testid="topbar-document-settings"
            aria-label="Document settings"
            aria-haspopup="dialog"
            aria-expanded={settingsExpanded ? 'true' : 'false'}
            aria-controls="lash-document-settings-dialog"
            data-tooltip="Document settings"
            onClick={(event) => onSettingsClick(event.currentTarget)}
          >
            <Icon name="gear" />
          </button>
        ) : null}

        {suggestionAvailable && onStartSuggestion ? (
          <button
            type="button"
            className="lash-icon-btn lash-topbar-suggest-action"
            data-testid="suggest-mode-toggle"
            aria-label="Suggest wording"
            data-tooltip="Suggest wording"
            onClick={(event) => onStartSuggestion(event.currentTarget)}
          >
            <Icon name="pencil" />
          </button>
        ) : null}

        <button
          ref={mobileToolsTriggerRef}
          type="button"
          className="lash-icon-btn lash-mobile-tools-button"
          data-testid="topbar-mobile-tools"
          aria-label="More document tools"
          aria-expanded={mobileToolsOpen ? 'true' : 'false'}
          aria-controls="lash-mobile-document-tools"
          onClick={() => setMobileToolsOpen((open) => !open)}
        >
          <Icon name="gear" />
        </button>

        {mobileToolsOpen ? (
          <div
            ref={mobileToolsPanelRef}
            id="lash-mobile-document-tools"
            className="lash-mobile-tools-panel"
            data-testid="mobile-document-tools-panel"
            role="group"
            aria-label="Document tools"
          >
            {onSettingsClick ? (
              <button
                type="button"
                className="lash-mobile-tools-action"
                data-testid="mobile-document-settings"
                onClick={(event) => {
                  onSettingsClick(mobileToolsTriggerRef.current ?? event.currentTarget);
                  closeMobileTools(false);
                }}
              >
                <Icon name="gear" />
                <span>Document settings</span>
              </button>
            ) : null}
            <button
              type="button"
              className="lash-mobile-tools-action"
              data-testid="mobile-focus-mode-toggle"
              aria-pressed={focusMode ? 'true' : 'false'}
              onClick={() => {
                onToggleFocusMode();
                closeMobileTools(true);
              }}
            >
              <Icon name={focusMode ? 'minimize' : 'maximize'} />
              <span>{focusMode ? 'Exit Focus' : 'Focus'}</span>
            </button>
            {suggestionAvailable && onStartSuggestion ? (
              <button
                type="button"
                className="lash-mobile-tools-action"
                data-testid="mobile-suggest-mode-toggle"
                onClick={(event) => {
                  onStartSuggestion(mobileToolsTriggerRef.current ?? event.currentTarget);
                  closeMobileTools(false);
                }}
              >
                <Icon name="pencil" />
                <span>Suggest wording</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {mobileDiscussionVisible && onDiscussionClick ? (
          <button
            type="button"
            className="lash-discussion-button"
            data-testid="topbar-discussion-button"
            aria-label="Discussion"
            aria-expanded={discussionExpanded ? 'true' : 'false'}
            aria-controls={shareControlsPresent ? 'lash-rail' : undefined}
            onClick={onDiscussionClick}
          >
            <span>Discussion</span>
          </button>
        ) : null}

        {onShareClick ? (
          <button
            type="button"
            className="lash-share-button"
            data-testid="topbar-share-button"
            aria-label="Share document"
            aria-haspopup={shareHasPopup}
            aria-expanded={shareExpanded ? 'true' : 'false'}
            aria-controls={
              shareHasPopup === 'dialog'
                ? shareExpanded
                  ? shareControlsId
                  : undefined
                : shareControlsPresent
                  ? shareControlsId
                  : undefined
            }
            onClick={onShareClick}
          >
            <Icon name="share" />
            <span className="lash-share-button-label">Share</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
