export interface MobileRailAction {
  documentId: string;
  run: () => void;
  cancel: () => void;
}

export interface MobileRailReleaseState {
  documentId: string;
  canvasAvailable: boolean;
  bodyScrollLocked: boolean;
}

export const createMobileRailActionCoordinator = () => {
  let pending: MobileRailAction | null = null;

  return {
    queue(action: MobileRailAction) {
      const previous = pending;
      pending = action;
      previous?.cancel();
    },
    cancel() {
      const current = pending;
      pending = null;
      current?.cancel();
      return current !== null;
    },
    notifyRelease(state: MobileRailReleaseState) {
      const current = pending;
      if (!current) return false;
      if (current.documentId !== state.documentId) {
        pending = null;
        current.cancel();
        return false;
      }
      if (!state.canvasAvailable || state.bodyScrollLocked) return false;

      // Clear before invoking so synchronous rerenders or duplicate
      // availability notifications cannot consume the action twice.
      pending = null;
      current.run();
      return true;
    },
    hasPending() {
      return pending !== null;
    },
  };
};
