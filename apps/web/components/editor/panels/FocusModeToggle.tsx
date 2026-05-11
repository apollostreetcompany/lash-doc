/**
 * panels/FocusModeToggle — the toggle button for focus mode.
 *
 * Owned by M1/B4: that lane fills in the additional chrome-hide behavior,
 * a11y wiring, and stylistic polish per agents.md A.4 (focus-mode-ui +
 * focus-mode-a11y). The button itself is stable.
 */
'use client';

export interface FocusModeToggleProps {
  isFocusMode: boolean;
  onToggle: () => void;
}

export function FocusModeToggle({ isFocusMode, onToggle }: FocusModeToggleProps) {
  return (
    <button
      type="button"
      data-testid="focus-mode-toggle"
      onClick={onToggle}
      aria-pressed={isFocusMode ? 'true' : 'false'}
      className="focus-mode-toggle"
    >
      {isFocusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
    </button>
  );
}
