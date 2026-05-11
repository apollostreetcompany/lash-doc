/**
 * panels/EditorToolbar — top-of-canvas formatting toolbar.
 *
 * Stable across M1; no lane modifies this directly. Marked-active state
 * comes from `editor` via `isToolbarButtonActive`.
 */
'use client';

import { isToolbarButtonActive, type ToolbarButtonSpec } from '@lash/editor-core';
import { ToolbarButton, ToolbarGroup } from '@lash/ui';
import type { Editor } from '@tiptap/core';

export interface ToolbarMeta {
  label: string;
  items: ToolbarButtonSpec[];
}

export interface EditorToolbarProps {
  editor: Editor | null;
  groups: ToolbarMeta[];
  hidden: boolean;
  onClick: (spec: ToolbarButtonSpec) => void;
}

export function EditorToolbar({ editor, groups, hidden, onClick }: EditorToolbarProps) {
  const ready = Boolean(editor);
  return (
    <div
      role="toolbar"
      aria-label="Editor toolbar"
      data-testid="lash-toolbar"
      className="lash-toolbar"
      hidden={hidden}
    >
      {groups.map(({ label, items }) => (
        <ToolbarGroup key={label} label={label}>
          {items.map((item) => {
            const active = editor ? isToolbarButtonActive(editor, item.id) : false;
            return (
              <ToolbarButton
                key={item.id}
                data-testid={`toolbar-btn-${item.id}`}
                title={item.hotkey ? `${item.label} (${item.hotkey})` : item.label}
                shortcut={item.hotkey}
                onClick={() => onClick(item)}
                active={active}
                disabled={!ready}
                icon={item.icon}
              />
            );
          })}
        </ToolbarGroup>
      ))}
    </div>
  );
}
