import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export interface ToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  children?: ReactNode;
}

const baseStyles: CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '0.95rem',
  lineHeight: 1.2,
  padding: '0.35rem 0.6rem',
  transition: 'background 0.15s ease, border-color 0.15s ease',
};

const activeStyles: CSSProperties = {
  background: 'rgba(59, 130, 246, 0.2)',
  borderColor: 'rgba(59, 130, 246, 0.6)',
};

const disabledStyles: CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};

export function ToolbarButton({
  active,
  icon,
  children,
  shortcut,
  disabled,
  style,
  ...rest
}: ToolbarButtonProps) {
  const computedStyle: CSSProperties = {
    ...baseStyles,
    ...(active ? activeStyles : {}),
    ...(disabled ? disabledStyles : {}),
    ...style,
  };

  const ariaPressed = active ? 'true' : 'false';

  return (
    <button
      type="button"
      aria-pressed={ariaPressed}
      data-active={active ? 'true' : 'false'}
      data-shortcut={shortcut}
      style={computedStyle}
      disabled={disabled}
      {...rest}
    >
      {icon ?? children}
    </button>
  );
}
