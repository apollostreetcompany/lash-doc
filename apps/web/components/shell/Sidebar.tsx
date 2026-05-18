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
  onCloseMobile?: () => void;
  /** When true, the outline section is omitted entirely (count goes to zero). */
  hideOutline?: boolean;
}

interface NavLink {
  icon: IconName;
  label: string;
  active?: boolean;
}

const PRIMARY_NAV: NavLink[] = [
  { icon: 'document', label: 'Current doc', active: true },
  { icon: 'home', label: 'Home' },
  { icon: 'inbox', label: 'Inbox' },
  { icon: 'starred', label: 'Starred' },
  { icon: 'people', label: 'Shared with me' },
];

const SECONDARY_NAV: NavLink[] = [
  { icon: 'documents', label: 'All documents' },
  { icon: 'gear', label: 'Settings' },
];

function NavItem({ icon, label, active }: NavLink) {
  return (
    <button
      type="button"
      className="lash-sidebar-item"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      <Icon name={icon} />
      <span className="lash-sidebar-item-label">{label}</span>
    </button>
  );
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  outlineItems,
  onToggleHeading,
  onFocusHeading,
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
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}

        {showOutline ? (
          <SidebarOutline
            items={outlineItems}
            onToggle={onToggleHeading}
            onFocus={onFocusHeading}
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
}

function SidebarOutline({ items, onToggle, onFocus }: SidebarOutlineProps): ReactNode {
  // OutlinePanel renders its own `Outline` heading; we provide the section
  // wrapper here but suppress an extra label to keep the chrome quiet.
  return (
    <div className="lash-sidebar-section">
      <OutlinePanel items={items} onToggle={onToggle} onFocus={onFocus} />
    </div>
  );
}
