/**
 * AppShell — pure layout wrapper.
 *
 * Renders the sidebar / topbar / canvas / rail grid and sets data
 * attributes that CSS uses to drive collapse / focus / responsive
 * behavior. All state (focus mode, sidebar collapsed, rail open, mobile
 * drawers) is owned by the parent so the chrome stays composable.
 *
 * On first mount the shell flips a transient `data-entrance` flag for
 * 800ms; CSS keyframes scoped to that flag run the choreography exactly
 * once.
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';

export interface AppShellProps {
  topBar: ReactNode;
  sidebar: ReactNode;
  rail: ReactNode | null;
  children: ReactNode;
  focusMode: boolean;
  railOpen: boolean;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  mobileRailOpen: boolean;
  onMobileSidebarClose: () => void;
  onMobileRailClose: () => void;
}

export function AppShell({
  topBar,
  sidebar,
  rail,
  children,
  focusMode,
  railOpen,
  sidebarCollapsed,
  mobileSidebarOpen,
  mobileRailOpen,
  onMobileSidebarClose,
  onMobileRailClose,
}: AppShellProps) {
  const [entrance, setEntrance] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setEntrance(false), 800);
    return () => clearTimeout(timer);
  }, []);

  // Close mobile drawers on Escape — the parent owns the state, so we
  // just call its close handlers.
  useEffect(() => {
    if (!mobileSidebarOpen && !mobileRailOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mobileSidebarOpen) onMobileSidebarClose();
        if (mobileRailOpen) onMobileRailClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileSidebarOpen, mobileRailOpen, onMobileSidebarClose, onMobileRailClose]);

  const drawerOpen = mobileSidebarOpen || mobileRailOpen;

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
      {sidebar}
      {topBar}

      <div className="lash-canvas" id="lash-main" tabIndex={-1}>
        {children}
      </div>

      {rail && railOpen ? rail : null}

      <button
        type="button"
        className="lash-app-backdrop"
        aria-label="Close menu"
        tabIndex={drawerOpen ? 0 : -1}
        aria-hidden={drawerOpen ? undefined : 'true'}
        onClick={() => {
          if (mobileSidebarOpen) onMobileSidebarClose();
          if (mobileRailOpen) onMobileRailClose();
        }}
      />
    </div>
  );
}
