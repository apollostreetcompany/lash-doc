/**
 * AppShell — three-column layout (sidebar / canvas / rail) with sticky topbar.
 *
 * Behavior is driven by data attributes on the root so CSS controls
 * collapse/focus/responsive behavior without React having to re-measure.
 */
'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

export interface AppShellProps {
  topBar: ReactNode;
  sidebar: ReactNode;
  rail: ReactNode | null;
  children: ReactNode;
  focusMode: boolean;
  railOpen: boolean;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onRailOpenChange: (open: boolean) => void;
}

export function AppShell({
  topBar,
  sidebar,
  rail,
  children,
  focusMode,
  railOpen,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onRailOpenChange,
}: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // Entrance choreography flag — scoped to first mount so animations don't
  // replay every time focus mode toggles or the rail closes.
  const [entrance, setEntrance] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setEntrance(false), 800);
    return () => clearTimeout(timer);
  }, []);

  // Close mobile drawers on escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false);
        setMobileRailOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const closeMobileRail = useCallback(() => setMobileRailOpen(false), []);

  return (
    <div
      className="lash-app"
      data-focus-mode={focusMode ? 'true' : 'false'}
      data-rail-open={railOpen ? 'true' : 'false'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      data-mobile-drawer={mobileSidebarOpen ? 'true' : 'false'}
      data-rail-mobile={mobileRailOpen ? 'true' : 'false'}
      data-entrance={entrance ? 'true' : 'false'}
    >
      {/* clone sidebar with onCloseMobile prop when on mobile drawer */}
      {sidebar}

      <SlotTopBar
        focusMode={focusMode}
        railOpen={railOpen}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={onSidebarCollapsedChange}
        onRailOpenChange={onRailOpenChange}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
      >
        {topBar}
      </SlotTopBar>

      <div className="lash-canvas" id="lash-main" tabIndex={-1}>
        {children}
      </div>

      {rail && railOpen ? rail : null}

      <button
        type="button"
        className="lash-app-backdrop"
        aria-label="Close menu"
        tabIndex={mobileSidebarOpen || mobileRailOpen ? 0 : -1}
        onClick={() => {
          closeMobileSidebar();
          closeMobileRail();
        }}
      />
    </div>
  );
}

interface SlotTopBarProps {
  children: ReactNode;
  focusMode: boolean;
  railOpen: boolean;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onRailOpenChange: (open: boolean) => void;
  onOpenMobileSidebar: () => void;
}

function SlotTopBar({ children }: SlotTopBarProps) {
  return <>{children}</>;
}
