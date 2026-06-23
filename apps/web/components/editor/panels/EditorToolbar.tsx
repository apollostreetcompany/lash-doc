/**
 * panels/EditorToolbar — sticky formatting toolbar at the top of the canvas.
 *
 * Renders icon buttons grouped by category (inline marks, blocks, lists,
 * insert). Active state comes from `isToolbarButtonActive`. The legacy
 * `lash-toolbar` selector and `toolbar-btn-${id}` test ids are preserved.
 */
'use client';

import { isToolbarButtonActive, type ToolbarButtonSpec } from '@lash/editor-core';
import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';

import { Icon, type IconName } from '../../shell/Icon';

export interface ToolbarMeta {
  label: string;
  items: ToolbarButtonSpec[];
}

export interface EditorToolbarProps {
  editor: Editor | null;
  groups: ToolbarMeta[];
  hidden: boolean;
  onClick: (spec: ToolbarButtonSpec) => void;
  trailing?: ReactNode;
}

const COMMAND_ICONS: Partial<Record<string, IconName>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  code: 'code',
  link: 'link',
  'heading-1': 'h1',
  'heading-2': 'h2',
  'heading-3': 'h3',
  'bullet-list': 'list-bullet',
  'ordered-list': 'list-numbered',
  checklist: 'list-check',
  'insert-table': 'table',
};

/**
 * Command ids that perform a one-shot action rather than toggle a persistent
 * state. These buttons never report an active state, so they must NOT carry
 * `aria-pressed` — a screen reader would otherwise announce them as an
 * (always unpressed) toggle, which is semantically inaccurate.
 */
const ACTION_COMMAND_IDS = new Set<string>(['insert-table']);

function shortcutHint(hotkey?: string) {
  if (!hotkey) return undefined;
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  return hotkey
    .replace(/Mod/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Alt/g, isMac ? '⌥' : 'Alt')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/\+/g, isMac ? '' : '+');
}

export function EditorToolbar({ editor, groups, hidden, onClick, trailing }: EditorToolbarProps) {
  const ready = Boolean(editor);

  return (
    <div className="lash-toolbar-bar" hidden={hidden} data-hidden={hidden ? 'true' : 'false'}>
      <div
        role="toolbar"
        aria-label="Editor toolbar"
        data-testid="lash-toolbar"
        className="lash-toolbar"
      >
        {groups.map(({ label, items }) => (
          <div key={label} role="group" aria-label={label} data-toolbar-group>
            {items.map((item) => {
              const isToggle = !ACTION_COMMAND_IDS.has(item.id);
              const active = isToggle && editor ? isToolbarButtonActive(editor, item.id) : false;
              const iconName = COMMAND_ICONS[item.id];
              const hint = shortcutHint(item.hotkey);
              const tooltip = hint ? `${item.label} (${hint})` : item.label;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="lash-icon-btn"
                  data-testid={`toolbar-btn-${item.id}`}
                  data-active={active ? 'true' : 'false'}
                  data-shortcut={item.hotkey}
                  data-tooltip={tooltip}
                  title={tooltip}
                  aria-label={item.label}
                  // Only toggle buttons expose a pressed state. Action buttons
                  // (e.g. insert-table) omit aria-pressed entirely so they are
                  // not announced as toggles.
                  aria-pressed={isToggle ? (active ? 'true' : 'false') : undefined}
                  disabled={!ready}
                  onClick={() => onClick(item)}
                >
                  {iconName ? <Icon name={iconName} /> : <span>{item.icon}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {trailing ? (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{trailing}</div>
      ) : null}
    </div>
  );
}
