/**
 * Sidebar — dark left navigation with collapsible width.
 *
 * Houses brand, primary nav, document outline, and the collapse toggle.
 */
'use client';

import type { OutlineItem } from '@lash/editor-core';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from './Icon';
import styles from './Sidebar.module.css';
import { OutlinePanel } from '../editor/panels/OutlinePanel';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  outlineItems: OutlineItem[];
  onToggleHeading: (item: OutlineItem) => void;
  onFocusHeading: (item: OutlineItem) => void;
  onExpandAll?: () => void;
  onCloseMobile?: () => void;
  /** When true, the outline section is omitted entirely (count goes to zero). */
  hideOutline?: boolean;
}

function CurrentDocItem() {
  // The current document is the active view; render it as a non-interactive
  // current-page marker rather than a clickable button that does nothing.
  return (
    <div className="lash-sidebar-item" data-active="true" aria-current="page" title="Current doc">
      <Icon name="document" />
      <span className="lash-sidebar-item-label">Current doc</span>
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  outlineItems,
  onToggleHeading,
  onFocusHeading,
  onExpandAll,
  onCloseMobile,
  hideOutline = false,
}: SidebarProps) {
  const showOutline = !hideOutline;
  const renderSidebarOutline = showOutline && (!collapsed || Boolean(onCloseMobile));
  return (
    <aside
      className="lash-sidebar"
      id="lash-sidebar"
      data-testid="lash-sidebar"
      aria-label="Workspace navigation"
    >
      <div className="lash-sidebar-brand">
        <span className="lash-sidebar-logo" aria-hidden="true">
          L
        </span>
        <span className="lash-sidebar-brand-text">Lash</span>
      </div>

      <nav className="lash-sidebar-nav">
        <Link
          href={'/documents' as Route}
          className={`lash-sidebar-item ${styles.documentsLink}`}
          aria-label="Documents"
          title="Documents"
          prefetch={false}
        >
          <Icon name="documents" />
          <span className={`lash-sidebar-item-label ${styles.documentsLabel}`}>Documents</span>
        </Link>
        <CurrentDocItem />

        {showOutline && collapsed && !onCloseMobile ? (
          <button
            type="button"
            className="lash-sidebar-item lash-sidebar-outline-access"
            aria-label="Show outline"
            title="Show outline"
            onClick={onToggleCollapsed}
            data-testid="sidebar-outline-access"
          >
            <Icon name="list-bullet" />
            <span className="lash-sidebar-item-label">Outline</span>
          </button>
        ) : null}

        {renderSidebarOutline ? (
          <SidebarOutline
            items={outlineItems}
            onToggle={onToggleHeading}
            onFocus={onFocusHeading}
            onExpandAll={onExpandAll}
          />
        ) : null}
      </nav>

      <div className="lash-sidebar-footer">
        {!onCloseMobile ? (
          <button
            type="button"
            className="lash-sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed ? 'true' : 'false'}
            onClick={onToggleCollapsed}
            data-testid="sidebar-collapse-toggle"
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
          </button>
        ) : null}
        {onCloseMobile ? (
          <button
            type="button"
            className="lash-sidebar-toggle"
            aria-label="Close menu"
            onClick={onCloseMobile}
            data-testid="sidebar-mobile-close"
            data-mobile-initial-focus="true"
            style={{ marginLeft: 'auto' }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </div>
    </aside>
  );
}

interface SidebarOutlineProps {
  items: OutlineItem[];
  onToggle: (item: OutlineItem) => void;
  onFocus: (item: OutlineItem) => void;
  onExpandAll?: () => void;
}

function SidebarOutline({ items, onToggle, onFocus, onExpandAll }: SidebarOutlineProps): ReactNode {
  // OutlinePanel renders its own `Outline` heading; we provide the section
  // wrapper here but suppress an extra label to keep the chrome quiet.
  return (
    <div className="lash-sidebar-section">
      <OutlinePanel
        items={items}
        onToggle={onToggle}
        onFocus={onFocus}
        onExpandAll={onExpandAll}
        testId="lash-sidebar-outline-panel"
        titleId="lash-sidebar-outline-title"
        testIdPrefix="sidebar-outline"
        title="Outline"
      />
    </div>
  );
}
