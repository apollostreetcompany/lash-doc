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

import { useEffect, useRef, useState, type ReactNode } from 'react';

const MOBILE_DRAWER_QUERY = '(max-width: 767px)';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const setSubtreeUnavailable = (element: HTMLElement | null, unavailable: boolean) => {
  if (!element) return;
  element.toggleAttribute('inert', unavailable);
  if (unavailable) {
    element.setAttribute('aria-hidden', 'true');
  } else {
    element.removeAttribute('aria-hidden');
  }
};

const focusableDescendants = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex >= 0,
  );

export interface MobileRailFocusRequest {
  trigger: HTMLElement | null;
  restoreFocus: boolean;
}

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
  mobileRailFocusRequest: MobileRailFocusRequest;
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
  mobileRailFocusRequest,
  onMobileSidebarClose,
  onMobileRailClose,
}: AppShellProps) {
  const [entrance, setEntrance] = useState(true);
  const appRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const drawerKindRef = useRef<'sidebar' | 'rail' | null>(null);
  const mobileModalOpenRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setEntrance(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const drawerOpen = mobileSidebarOpen || mobileRailOpen;

  // Mobile drawers are modal disclosures. Closed surfaces are removed from
  // focus/AT, opening moves focus into the active drawer, and the remaining
  // shell becomes inert until the parent closes the drawer. CSS supplies the
  // first-frame visibility boundary; this effect supplies runtime semantics.
  useEffect(() => {
    const app = appRef.current;
    if (!app || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(MOBILE_DRAWER_QUERY);

    const sync = () => {
      const sidebar = app.querySelector<HTMLElement>('.lash-sidebar');
      const rail = app.querySelector<HTMLElement>('.lash-rail');
      const topBar = app.querySelector<HTMLElement>('.lash-topbar');
      const menuTrigger = app.querySelector<HTMLElement>('[data-testid="topbar-mobile-menu"]');

      const mobileModalOpen = media.matches && drawerOpen;
      if (mobileModalOpen && !mobileModalOpenRef.current) {
        drawerKindRef.current = mobileRailOpen ? 'rail' : 'sidebar';
        drawerTriggerRef.current = mobileRailOpen ? mobileRailFocusRequest.trigger : menuTrigger;
      }
      if (
        mobileModalOpen &&
        drawerKindRef.current === 'rail' &&
        mobileRailOpen &&
        mobileRailFocusRequest.restoreFocus &&
        mobileRailFocusRequest.trigger
      ) {
        drawerTriggerRef.current = mobileRailFocusRequest.trigger;
      }

      if (!media.matches) {
        setSubtreeUnavailable(sidebar, false);
        setSubtreeUnavailable(rail, false);
        setSubtreeUnavailable(topBar, false);
        setSubtreeUnavailable(canvasRef.current, false);
        if (mobileModalOpenRef.current) {
          if (drawerKindRef.current !== 'rail' || mobileRailFocusRequest.restoreFocus) {
            drawerTriggerRef.current?.focus({ preventScroll: true });
          }
          drawerTriggerRef.current = null;
          drawerKindRef.current = null;
        }
        mobileModalOpenRef.current = false;
        return;
      }

      const activeDrawer = mobileRailOpen ? rail : mobileSidebarOpen ? sidebar : null;
      setSubtreeUnavailable(sidebar, !mobileSidebarOpen || mobileRailOpen);
      setSubtreeUnavailable(rail, !mobileRailOpen);

      if (activeDrawer && !activeDrawer.contains(document.activeElement)) {
        const initialFocus =
          activeDrawer.querySelector<HTMLElement>('[data-mobile-initial-focus="true"]') ??
          activeDrawer.querySelector<HTMLElement>('[aria-current="true"]') ??
          focusableDescendants(activeDrawer)[0];
        initialFocus?.focus({ preventScroll: true });
      }

      setSubtreeUnavailable(topBar, drawerOpen);
      setSubtreeUnavailable(canvasRef.current, drawerOpen);

      if (!mobileModalOpen && mobileModalOpenRef.current) {
        if (drawerKindRef.current !== 'rail' || mobileRailFocusRequest.restoreFocus) {
          drawerTriggerRef.current?.focus({ preventScroll: true });
        }
        drawerTriggerRef.current = null;
        drawerKindRef.current = null;
      }
      mobileModalOpenRef.current = mobileModalOpen;
    };

    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [
    drawerOpen,
    mobileRailFocusRequest.restoreFocus,
    mobileRailFocusRequest.trigger,
    mobileRailOpen,
    mobileSidebarOpen,
    railOpen,
  ]);

  // Close on Escape and contain Tab/Shift+Tab in the active mobile drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        typeof window.matchMedia === 'function' &&
        !window.matchMedia(MOBILE_DRAWER_QUERY).matches
      ) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mobileSidebarOpen) onMobileSidebarClose();
        if (mobileRailOpen) onMobileRailClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const app = appRef.current;
      const activeDrawer = mobileRailOpen
        ? app?.querySelector<HTMLElement>('.lash-rail')
        : app?.querySelector<HTMLElement>('.lash-sidebar');
      if (!activeDrawer) return;
      const focusable = focusableDescendants(activeDrawer);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !activeDrawer.contains(current))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (current === last || !activeDrawer.contains(current))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, mobileSidebarOpen, mobileRailOpen, onMobileSidebarClose, onMobileRailClose]);

  return (
    <div
      ref={appRef}
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

      <div className="lash-canvas" id="lash-main" tabIndex={-1} ref={canvasRef}>
        {children}
      </div>

      {rail && railOpen ? rail : null}

      <button
        type="button"
        className="lash-app-backdrop"
        aria-label="Close menu"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => {
          if (mobileSidebarOpen) onMobileSidebarClose();
          if (mobileRailOpen) onMobileRailClose();
        }}
      />
    </div>
  );
}
