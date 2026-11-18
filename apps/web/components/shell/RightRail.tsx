/**
 * RightRail — focused activity tabs (Chat / History / AI / Share / Activity).
 *
 * The parent owns the selected activity. Every panel keeps a stable React
 * identity so local drafts and review state survive switching, while inactive
 * panel containers use the native hidden state and do not participate in
 * layout, focus order, or the accessibility tree.
 */
'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

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
  jumpRequest?: { id: RailTab; requestId: number } | null;
}

// A request is an immutable parent-state object. Remembering its identity lets
// a rail remount ignore a stale request while still accepting a new request
// whose numeric sequence happens to match.
const handledJumpRequests = new WeakSet<object>();

export function RightRail({ active, onChange, tabs, onClose, jumpRequest }: RightRailProps) {
  const tabRefs = useRef<Partial<Record<RailTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!jumpRequest || handledJumpRequests.has(jumpRequest)) return;
    handledJumpRequests.add(jumpRequest);
    onChange(jumpRequest.id);
  }, [jumpRequest, onChange]);

  const activateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onChange(nextTab.id);
    tabRefs.current[nextTab.id]?.focus({ preventScroll: true });
  };

  return (
    <aside
      className="lash-rail"
      id="lash-rail"
      data-testid="lash-rail"
      aria-label="Document activity"
    >
      <div className="lash-rail-tabs">
        <div className="lash-rail-tablist" role="tablist" aria-label="Discussion sections">
          {tabs.map((tab, index) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[tab.id] = element;
                }}
                id={`rail-tab-${tab.id}`}
                type="button"
                role="tab"
                className="lash-rail-tab"
                data-active={selected ? 'true' : 'false'}
                data-testid={`rail-tab-${tab.id}`}
                aria-label={tab.label}
                aria-selected={selected ? 'true' : 'false'}
                aria-controls={`rail-section-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                data-mobile-initial-focus={selected ? 'true' : undefined}
                onClick={() => onChange(tab.id)}
                onKeyDown={(event) => activateFromKeyboard(event, index)}
              >
                <Icon name={tab.icon} />
                <span className="lash-rail-tab-text">{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 ? (
                  <span className="lash-rail-tab-badge" aria-label={`${tab.badge} updates`}>
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {onClose ? (
          <button
            type="button"
            className="lash-icon-btn lash-rail-close"
            aria-label="Close activity panel"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </div>

      <div className="lash-rail-body">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <section
              key={tab.id}
              id={`rail-section-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`rail-tab-${tab.id}`}
              data-section-id={tab.id}
              data-active={selected ? 'true' : 'false'}
              className="lash-rail-section"
              hidden={!selected}
            >
              {tab.content}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
