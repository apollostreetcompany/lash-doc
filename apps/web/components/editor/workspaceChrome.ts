import type { MobileRailFocusRequest } from '../shell/AppShell';
import type { RailTab } from '../shell/RightRail';

export const MOBILE_WORKSPACE_QUERY = '(max-width: 767px)';

export type WorkspaceViewport = 'desktop' | 'mobile';

export type WorkspaceChrome = {
  viewport: WorkspaceViewport;
  focusMode: boolean;
  desktopRailOpen: boolean;
  drawer: 'sidebar' | 'rail' | null;
  activeTab: RailTab;
  railFocus: MobileRailFocusRequest;
};

type ChromeAction =
  | { type: 'viewport'; viewport: WorkspaceViewport }
  | { type: 'focus' }
  | { type: 'open-sidebar' }
  | { type: 'close-sidebar' }
  | { type: 'open-rail'; viewport: WorkspaceViewport; tab: RailTab; trigger: HTMLElement | null }
  | { type: 'close-rail'; restoreFocus: boolean }
  | { type: 'select-tab'; tab: RailTab }
  | { type: 'rail-return-target'; trigger: HTMLElement };

export const initialWorkspaceChrome: WorkspaceChrome = {
  viewport: 'desktop',
  focusMode: false,
  desktopRailOpen: false,
  drawer: null,
  activeTab: 'chat',
  railFocus: { trigger: null, restoreFocus: true },
};

export function transitionWorkspaceChrome(
  state: WorkspaceChrome,
  action: ChromeAction,
): WorkspaceChrome {
  switch (action.type) {
    case 'viewport':
      if (state.viewport === action.viewport) return state;
      return {
        ...state,
        viewport: action.viewport,
        // A visible mobile discussion can become a non-modal desktop rail.
        desktopRailOpen: state.desktopRailOpen || state.drawer === 'rail',
        drawer: null,
      };
    case 'focus':
      return { ...state, focusMode: !state.focusMode, drawer: null };
    case 'open-sidebar':
      return { ...state, viewport: 'mobile', focusMode: false, drawer: 'sidebar' };
    case 'close-sidebar':
      return state.drawer === 'sidebar' ? { ...state, drawer: null } : state;
    case 'open-rail':
      return {
        ...state,
        viewport: action.viewport,
        focusMode: false,
        desktopRailOpen: action.viewport === 'desktop' || state.desktopRailOpen,
        drawer: action.viewport === 'mobile' ? 'rail' : null,
        activeTab: action.tab,
        railFocus: { trigger: action.trigger, restoreFocus: true },
      };
    case 'close-rail':
      return {
        ...state,
        desktopRailOpen: state.viewport === 'desktop' ? false : state.desktopRailOpen,
        drawer: state.drawer === 'rail' ? null : state.drawer,
        railFocus: { ...state.railFocus, restoreFocus: action.restoreFocus },
      };
    case 'select-tab':
      return state.activeTab === action.tab ? state : { ...state, activeTab: action.tab };
    case 'rail-return-target':
      return { ...state, railFocus: { trigger: action.trigger, restoreFocus: true } };
  }
}
