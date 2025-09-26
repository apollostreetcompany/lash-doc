import type { CSSProperties, ReactNode } from 'react';

export interface ToolbarGroupProps {
  label: string;
  children: ReactNode;
}

const groupStyles: CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  alignItems: 'center',
};

export function ToolbarGroup({ label, children }: ToolbarGroupProps) {
  return (
    <div role="group" aria-label={label} style={groupStyles} data-toolbar-group>
      {children}
    </div>
  );
}
