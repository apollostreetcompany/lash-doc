/**
 * Sidebar — dark left navigation with collapsible width.
 *
 * Houses brand, primary nav, document outline, and the collapse toggle.
 */
'use client';

import type { OutlineItem } from '@lash/editor-core';
import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';
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

interface NavLink {
  icon: IconName;
  label: string;
}

// These workspace destinations are not yet routed. Until navigation is wired,
// they are rendered as explicitly disabled "coming soon" controls so users are
// not misled into clicking dead buttons (see F-C01-07 / F-C25-07). The current
// document is already the active view, so it is shown as a non-interactive
// current-page marker rather than a clickable link.
const PRIMARY_NAV: NavLink[] = [
  { icon: 'home', label: 'Home' },
  { icon: 'inbox', label: 'Inbox' },
  { icon: 'starred', label: 'Starred' },
  { icon: 'people', label: 'Shared with me' },
];

const SECONDARY_NAV: NavLink[] = [
  { icon: 'documents', label: 'All documents' },
  { icon: 'gear', label: 'Settings' },
];

function NavItem({ icon, label }: NavLink) {
  // No destination is wired yet, so the control is disabled and announced as
  // unavailable instead of presenting a clickable-but-inert affordance.
  return (
    <button
      type="button"
      className="lash-sidebar-item"
      data-disabled="true"
      disabled
      aria-disabled="true"
      title={`${label} (coming soon)`}
    >
      <Icon name={icon} />
      <span className="lash-sidebar-item-label">{label}</span>
      <span className="lash-sidebar-item-badge">Soon</span>
    </button>
  );
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
  return (
    <aside className="lash-sidebar" data-testid="lash-sidebar" aria-label="Workspace navigation">
      <div className="lash-sidebar-brand">
        <span className="lash-sidebar-logo" aria-hidden="true">
          L
        </span>
        <span className="lash-sidebar-brand-text">Lash</span>
      </div>

      <nav className="lash-sidebar-nav">
        <CurrentDocItem />
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}

        {showOutline && collapsed ? (
          <button
            type="button"
            className="lash-sidebar-item"
            aria-label="Show outline"
            title="Show outline"
            onClick={onToggleCollapsed}
            data-testid="sidebar-outline-access"
          >
            <Icon name="list-bullet" />
            <span className="lash-sidebar-item-label">Outline</span>
          </button>
        ) : null}

        {showOutline ? (
          <SidebarOutline
            items={outlineItems}
            onToggle={onToggleHeading}
            onFocus={onFocusHeading}
            onExpandAll={onExpandAll}
          />
        ) : null}

        <div className="lash-sidebar-section">
          {SECONDARY_NAV.map((item) => (
            <NavItem key={item.label} {...item} />
          ))}
        </div>
      </nav>

      <div className="lash-sidebar-footer">
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
        {onCloseMobile ? (
          <button
            type="button"
            className="lash-sidebar-toggle"
            aria-label="Close menu"
            onClick={onCloseMobile}
            data-testid="sidebar-mobile-close"
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
      <OutlinePanel items={items} onToggle={onToggle} onFocus={onFocus} onExpandAll={onExpandAll} />
    </div>
  );
}
