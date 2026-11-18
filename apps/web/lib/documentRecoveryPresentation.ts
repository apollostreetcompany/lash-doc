export type DocumentRecoveryPresentation = {
  canDiscardAndLeave: boolean;
  canExport: boolean;
  detail: string;
  heading: string;
};

export const documentRecoveryPresentation = (
  phase: 'recovery-available' | 'recovery-blocked',
  recoveryUpdateCount: number,
  recoveryExportAvailable: boolean,
): DocumentRecoveryPresentation => {
  const updates = `${recoveryUpdateCount} unsynced ${
    recoveryUpdateCount === 1 ? 'update' : 'updates'
  }`;
  if (phase === 'recovery-available') {
    return {
      canDiscardAndLeave: true,
      canExport: recoveryExportAvailable,
      heading: 'Local recovery is ready',
      detail: `${updates} were verified in local recovery storage. Export a copy, or explicitly discard the recovery before leaving.`,
    };
  }
  return {
    canDiscardAndLeave: false,
    canExport: recoveryExportAvailable,
    heading: 'Local recovery needs attention',
    detail: recoveryExportAvailable
      ? `${updates} are still retained in this tab because Lash could not verify recovery storage. Export them now; destructive navigation remains blocked.`
      : `${updates} are still retained in this tab, but an exact export snapshot is unavailable. Keep this tab open; destructive navigation remains blocked.`,
  };
};
