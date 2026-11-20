'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = ['a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]'].join(
  ',',
);

const setSubtreeUnavailable = (element: HTMLElement | null, unavailable: boolean) => {
  if (!element) return;
  element.toggleAttribute('inert', unavailable);
  if (unavailable) {
    element.setAttribute('aria-hidden', 'true');
  } else {
    element.removeAttribute('aria-hidden');
  }
};

const isAvailable = (element: HTMLElement) => {
  if (!element.isConnected || element.matches(':disabled')) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (getComputedStyle(element).visibility === 'hidden') return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === 'none') return false;
  }
  return true;
};

const focusableDescendants = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && isAvailable(element),
  );

const setDrawerModal = (drawer: HTMLElement | null, modal: boolean) => {
  if (!drawer) return;
  if (modal) {
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.tabIndex = -1;
  } else {
    drawer.removeAttribute('role');
    drawer.removeAttribute('aria-modal');
    drawer.removeAttribute('tabindex');
  }
};

type MobileDrawer = { kind: 'sidebar' } | { kind: 'rail'; trigger: HTMLElement | null };
type DrawerFocus = { kind: MobileDrawer['kind']; trigger: HTMLElement | null };

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
  mobileViewport: boolean;
  mobileDrawer: MobileDrawer | null;
  restoreMobileDrawerFocus: boolean;
  onMobileDrawerClose: () => void;
}

export function AppShell({
  topBar,
  sidebar,
  rail,
  children,
  focusMode,
  railOpen,
  sidebarCollapsed,
  mobileViewport,
  mobileDrawer,
  restoreMobileDrawerFocus,
  onMobileDrawerClose,
}: AppShellProps) {
  const appRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drawerFocusRef = useRef<DrawerFocus | null>(null);
  const drawerKind = mobileViewport ? mobileDrawer?.kind : undefined;
  const railTrigger = mobileDrawer?.kind === 'rail' ? mobileDrawer.trigger : null;

  useLayoutEffect(() => {
    const app = appRef.current;
    const canvas = canvasRef.current;
    if (!app || !canvas) return;
    const navigation = app.querySelector<HTMLElement>('.lash-sidebar');
    const activity = app.querySelector<HTMLElement>('.lash-rail');
    const header = app.querySelector<HTMLElement>('.lash-topbar');
    const drawer = drawerKind === 'sidebar' ? navigation : drawerKind === 'rail' ? activity : null;
    setDrawerModal(navigation, drawerKind === 'sidebar');
    setDrawerModal(activity, drawerKind === 'rail');

    if (!drawer || !drawerKind) {
      const previous = drawerFocusRef.current;
      drawerFocusRef.current = null;
      setSubtreeUnavailable(header, false);
      setSubtreeUnavailable(canvas, false);
      setSubtreeUnavailable(navigation, mobileViewport);
      setSubtreeUnavailable(activity, mobileViewport);
      if (previous && (previous.kind === 'sidebar' || restoreMobileDrawerFocus)) {
        const trigger = previous.trigger;
        const desktopNavigation = !mobileViewport && previous.kind === 'sidebar' && navigation;
        const returnTarget =
          trigger && isAvailable(trigger)
            ? trigger
            : (desktopNavigation && focusableDescendants(desktopNavigation)[0]) || canvas;
        returnTarget.focus({ preventScroll: true });
      }
      return;
    }

    const previous = drawerFocusRef.current;
    if (drawerKind === 'rail' || previous?.kind !== drawerKind) {
      const trigger =
        drawerKind === 'rail'
          ? railTrigger
          : (header?.querySelector<HTMLElement>('[aria-controls="lash-sidebar"]') ?? null);
      drawerFocusRef.current = { kind: drawerKind, trigger };
    }
    setSubtreeUnavailable(drawer, false);
    if (!drawer.contains(document.activeElement)) {
      const initialFocus =
        drawer.querySelector<HTMLElement>('[data-mobile-initial-focus="true"]') ??
        focusableDescendants(drawer)[0] ??
        drawer;
      initialFocus.focus({ preventScroll: true });
    }
    setSubtreeUnavailable(header, true);
    setSubtreeUnavailable(canvas, true);
    setSubtreeUnavailable(drawerKind === 'rail' ? navigation : activity, true);

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onMobileDrawerClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableDescendants(drawer);
      const first = focusable[0];
      const last = focusable.at(-1);
      const current = document.activeElement;
      const outside = !drawer.contains(current) || current === drawer;
      if (!first || (event.shiftKey ? outside || current === first : outside || current === last)) {
        event.preventDefault();
        (event.shiftKey ? (last ?? drawer) : (first ?? drawer)).focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    drawerKind,
    mobileViewport,
    onMobileDrawerClose,
    railOpen,
    railTrigger,
    restoreMobileDrawerFocus,
  ]);

  return (
    <div
      ref={appRef}
      className="lash-app"
      data-focus-mode={focusMode ? 'true' : 'false'}
      data-rail-open={railOpen ? 'true' : 'false'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      data-mobile-drawer={drawerKind === 'sidebar' ? 'true' : 'false'}
      data-rail-mobile={drawerKind === 'rail' ? 'true' : 'false'}
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
        onClick={onMobileDrawerClose}
      />
    </div>
  );
}
