'use client';

export type LocalBodyNotice =
  | { kind: 'recovered'; detail?: string }
  | { kind: 'recovery-error'; detail?: string }
  | { kind: 'conflict'; detail?: string }
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'failed'; detail?: string }
  | { kind: 'save-error'; detail?: string };

export interface LocalBodyRecoveryNoticeProps {
  notice: LocalBodyNotice;
  onKeepRecoveredCopy?: () => void;
  onReloadNewerCopy?: () => void;
}

export function LocalBodyRecoveryNotice({
  notice,
  onKeepRecoveredCopy,
  onReloadNewerCopy,
}: LocalBodyRecoveryNoticeProps) {
  const isRecovery = notice.kind === 'recovered';
  const canRetryRecovery = notice.kind === 'recovered' || notice.kind === 'recovery-error';
  const copy =
    notice.kind === 'recovered'
      ? 'Recovered an earlier saved copy. Review it before keeping it as the current document.'
      : notice.kind === 'recovery-error'
        ? 'Could not keep the recovered copy. It remains locked and unchanged; retry or export it before leaving.'
        : notice.kind === 'conflict'
          ? 'This document changed in another tab. Your current tab will not overwrite it.'
          : notice.kind === 'unavailable'
            ? 'Local saving is unavailable. Copy or export your work before leaving this page.'
            : notice.kind === 'failed'
              ? 'Saved document data could not be opened. The original browser records were preserved.'
              : 'Save failed. Copy or export recent work before leaving; any previously verified copy was left unchanged.';

  return (
    <div
      className="lash-local-body-notice"
      data-kind={notice.kind}
      data-testid="local-body-notice"
      role={isRecovery ? 'status' : 'alert'}
      aria-live={isRecovery ? 'polite' : 'assertive'}
    >
      <span>
        {copy}
        {notice.detail ? (
          <span className={notice.kind === 'recovery-error' ? undefined : 'sr-only'}>
            {' '}
            {notice.detail}
          </span>
        ) : null}
      </span>
      {canRetryRecovery && onKeepRecoveredCopy ? (
        <button
          type="button"
          className="lash-local-body-notice-action"
          data-testid="keep-recovered-copy"
          onClick={onKeepRecoveredCopy}
        >
          {notice.kind === 'recovery-error'
            ? 'Retry keeping recovered copy'
            : 'Keep recovered copy'}
        </button>
      ) : null}
      {notice.kind === 'conflict' && onReloadNewerCopy ? (
        <button
          type="button"
          className="lash-local-body-notice-action"
          data-testid="reload-newer-copy"
          onClick={onReloadNewerCopy}
        >
          Reload newer copy
        </button>
      ) : null}
    </div>
  );
}
