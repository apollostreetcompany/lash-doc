/**
 * RightRail — tabbed activity rail (Chat / History / AI / Share / Activity).
 *
 * All panels render simultaneously in a single scrolling column; the tab bar
 * highlights the section and scrolls it into view on click. This preserves
 * the visual hierarchy while keeping every panel addressable for tests.
 */
'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type RailTab = 'chat' | 'history' | 'ai' | 'share' | 'activity';

export interface RailTabConfig {
  id: RailTab;
  label: string;
  icon: IconName;
  badge?: number;
  content: ReactNode;
}

export interface RightRailProps {
  active: RailTab;
  onChange: (tab: RailTab) => void;
  tabs: RailTabConfig[];
  onClose?: () => void;
}

export function RightRail({ active, onChange, tabs, onClose }: RightRailProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const handleTabClick = useCallback(
    (id: RailTab) => {
      onChange(id);
      const body = bodyRef.current;
      if (!body) return;
      const target = body.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [onChange],
  );

  // Keep the active tab in sync with the section currently in view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const sections = Array.from(body.querySelectorAll<HTMLElement>('[data-section-id]'));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = visible.target.getAttribute('data-section-id') as RailTab | null;
        if (id) onChange(id);
      },
      { root: body, threshold: [0.25, 0.5, 0.75] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onChange]);

  return (
    <aside className="lash-rail" data-testid="lash-rail" aria-label="Document activity panel">
      <div className="lash-rail-tabs" role="tablist" aria-label="Activity tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            aria-controls={`rail-section-${tab.id}`}
            id={`rail-tab-${tab.id}`}
            className="lash-rail-tab"
            data-active={tab.id === active ? 'true' : 'false'}
            data-testid={`rail-tab-${tab.id}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <Icon name={tab.icon} />
            <span className="lash-rail-tab-text">{tab.label}</span>
            {typeof tab.badge === 'number' && tab.badge > 0 ? (
              <span className="lash-rail-tab-badge" aria-label={`${tab.badge} updates`}>
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
          </button>
        ))}

        {onClose ? (
          <button
            type="button"
            className="lash-icon-btn"
            aria-label="Close panel"
            onClick={onClose}
            style={{ marginLeft: 'auto', alignSelf: 'center' }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </div>

      <div className="lash-rail-body" ref={bodyRef}>
        {tabs.map((tab) => (
          <section
            key={tab.id}
            id={`rail-section-${tab.id}`}
            aria-labelledby={`rail-tab-${tab.id}`}
            data-section-id={tab.id}
            data-active={tab.id === active ? 'true' : 'false'}
            className="lash-rail-section"
          >
            {tab.content}
          </section>
        ))}
      </div>
    </aside>
  );
}
