/**
 * RightRail — section-jump activity rail (Chat / History / AI / Share / Activity).
 *
 * All panels render as siblings inside a scrolling column. The chip row at
 * the top acts as a section navigator: clicking a chip scrolls to that
 * section, and an IntersectionObserver keeps the active chip in sync with
 * what's visible. We deliberately use nav + aria-current semantics rather
 * than tablist/tab — every panel is reachable regardless of which chip is
 * "active", and assistive-tech users shouldn't be told otherwise.
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

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export function RightRail({ active, onChange, tabs, onClose }: RightRailProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Programmatic scrollIntoView fires the observer mid-flight on iOS; arm a
  // brief lockout window after every chip click so the observer can't
  // immediately override the user's tap-to-jump.
  const scrollLockRef = useRef<number>(0);

  const handleTabClick = useCallback(
    (id: RailTab) => {
      onChange(id);
      const body = bodyRef.current;
      if (!body) return;
      const target = body.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
      if (target) {
        scrollLockRef.current = Date.now() + 400;
        target.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        });
      }
    },
    [onChange],
  );

  // Keep the active chip in sync with the section currently in view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const sections = Array.from(body.querySelectorAll<HTMLElement>('[data-section-id]'));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < scrollLockRef.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio > 0.25)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = visible.target.getAttribute('data-section-id') as RailTab | null;
        if (id) onChange(id);
      },
      // The negative bottom rootMargin suppresses false fires near the
      // bottom of the rail during iOS rubber-band overscroll, which would
      // otherwise yank the active chip onto whatever section is briefly
      // pushed into view.
      { root: body, rootMargin: '0px 0px -40% 0px', threshold: [0.25, 0.5, 0.75] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onChange]);

  return (
    <aside className="lash-rail" id="lash-rail" data-testid="lash-rail" aria-label="Document activity">
      <nav
        className="lash-rail-tabs"
        aria-label="Jump to activity section"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="lash-rail-tab"
            data-active={tab.id === active ? 'true' : 'false'}
            data-testid={`rail-tab-${tab.id}`}
            aria-current={tab.id === active ? 'true' : undefined}
            aria-controls={`rail-section-${tab.id}`}
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
            aria-label="Close activity panel"
            onClick={onClose}
            style={{ marginLeft: 'auto', alignSelf: 'center' }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </nav>

      <div className="lash-rail-body" ref={bodyRef}>
        {tabs.map((tab) => (
          <section
            key={tab.id}
            id={`rail-section-${tab.id}`}
            aria-labelledby={`rail-section-label-${tab.id}`}
            data-section-id={tab.id}
            data-active={tab.id === active ? 'true' : 'false'}
            className="lash-rail-section"
          >
            <h2 id={`rail-section-label-${tab.id}`} className="sr-only">
              {tab.label}
            </h2>
            {tab.content}
          </section>
        ))}
      </div>
    </aside>
  );
}
