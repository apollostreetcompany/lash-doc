/**
 * Avatar / AvatarStack — circular initials avatars with overlap stacking.
 */
'use client';

import type { ReactNode } from 'react';

export type AvatarTint = 'coral' | 'blue' | 'green' | 'violet' | 'amber';

export interface AvatarProps {
  name: string;
  tint?: AvatarTint;
  title?: string;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

export function Avatar({ name, tint = 'coral', title }: AvatarProps) {
  return (
    <span
      className="lash-avatar"
      data-tint={tint === 'coral' ? undefined : tint}
      title={title ?? name}
      aria-label={name}
    >
      {initialsOf(name) || '·'}
    </span>
  );
}

export interface AvatarStackProps {
  children: ReactNode;
}

export function AvatarStack({ children }: AvatarStackProps) {
  return <span className="lash-avatar-stack">{children}</span>;
}
