/**
 * panels/OutlinePanel — left-side outline panel.
 *
 * Owned by editor-core/plugins/outline; this is a thin React render layer.
 * No B-lane currently modifies this directly; it stays stable through M1.
 */
'use client';

import type { OutlineItem } from '@lash/editor-core';

export interface OutlinePanelProps {
  items: OutlineItem[];
  onToggle: (item: OutlineItem) => void;
  onFocus: (item: OutlineItem) => void;
  onExpandAll?: () => void;
  testId?: string;
  titleId?: string;
  testIdPrefix?: string;
  title?: string;
}

export function OutlinePanel({
  items,
  onToggle,
  onFocus,
  onExpandAll,
  testId = 'lash-outline-panel',
  titleId = 'lash-outline-title',
  testIdPrefix = 'outline',
  title = 'Outline',
}: OutlinePanelProps) {
  const hasCollapsed = items.some((item) => item.collapsed);
  return (
    <aside
      data-testid={testId}
      role="navigation"
      aria-labelledby={titleId}
      className="lash-outline-panel"
    >
      <div className="outline-header">
        <h2 className="outline-title" id={titleId}>
          {title}
        </h2>
        {onExpandAll ? (
          <button
            type="button"
            className="outline-expand-all-button"
            data-testid={`${testIdPrefix}-expand-all`}
            onClick={onExpandAll}
            disabled={!hasCollapsed}
            aria-label="Expand all headings"
            title={hasCollapsed ? 'Expand all headings' : 'All headings expanded'}
          >
            Expand all
          </button>
        ) : null}
      </div>
      <ol className="outline-list" aria-labelledby={titleId}>
        {items.map((item) => {
          const indentStyle = { marginLeft: `${(item.level - 1) * 1.1}rem` };
          const metaLabel = `${item.descendantCount} sections · ${item.hiddenBlockCount} blocks`;
          return (
            <li
              key={item.headingId}
              data-heading-id={item.headingId}
              className="outline-entry"
              data-level={item.level}
              data-collapsed={item.collapsed ? 'true' : 'false'}
              style={indentStyle}
            >
              <button
                type="button"
                className="outline-collapse-button"
                data-testid={`${testIdPrefix}-toggle-${item.headingId}`}
                aria-label={`${item.collapsed ? 'Expand' : 'Collapse'} ${item.title}`}
                aria-expanded={item.collapsed ? 'false' : 'true'}
                onClick={() => onToggle(item)}
              >
                {item.collapsed ? '▶' : '▼'}
              </button>
              <button
                type="button"
                className="outline-jump-button"
                data-testid={`${testIdPrefix}-jump-${item.headingId}`}
                aria-label={`Jump to ${item.title}`}
                onClick={() => onFocus(item)}
              >
                <span className="outline-text">{item.title}</span>
                <span className="outline-meta" aria-hidden="true">
                  {metaLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
