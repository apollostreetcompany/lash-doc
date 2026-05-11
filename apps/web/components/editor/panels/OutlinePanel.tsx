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
}

export function OutlinePanel({ items, onToggle, onFocus }: OutlinePanelProps) {
  return (
    <aside
      data-testid="lash-outline-panel"
      aria-label="Document outline"
      className="lash-outline-panel"
    >
      <div className="outline-header">
        <h2 className="outline-title" id="lash-outline-title">
          Outline
        </h2>
      </div>
      <ol className="outline-list" aria-labelledby="lash-outline-title">
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
                data-testid={`outline-toggle-${item.headingId}`}
                aria-label={item.collapsed ? 'Expand section' : 'Collapse section'}
                aria-expanded={item.collapsed ? 'false' : 'true'}
                onClick={() => onToggle(item)}
              >
                {item.collapsed ? '▶' : '▼'}
              </button>
              <button
                type="button"
                className="outline-jump-button"
                data-testid={`outline-jump-${item.headingId}`}
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
