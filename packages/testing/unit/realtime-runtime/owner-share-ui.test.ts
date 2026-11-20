import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('account-owner Share UI contract', () => {
  it('uses a focused dialog instead of the normal activity rail', () => {
    const workspace = read('apps/web/components/editor/EditorWorkspace.tsx');
    const dialog = read('apps/web/components/editor/panels/OwnerShareDialog.tsx');
    const topBar = read('apps/web/components/shell/TopBar.tsx');

    expect(dialog).toContain('<dialog');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('Save to my account');
    expect(dialog).toContain('Saved to your account');
    expect(topBar).toContain('aria-haspopup={shareHasPopup}');
    expect(workspace).toContain("'lash-owner-share-dialog'");
    expect(workspace).toContain("runtimeMode === 'development-loopback'");
    expect(workspace).toContain('<OwnerShareDialog');
  });

  it('checks account state without exposing the principal and uses the existing return contract', () => {
    const workspace = read('apps/web/components/editor/EditorWorkspace.tsx');

    expect(workspace).toContain("fetch('/api/account/session'");
    expect(workspace).toContain("'x-lash-account-status'");
    expect(workspace).not.toContain("'x-lash-principal-id'");
    expect(workspace).toContain('/auth/sign-in?next=');
  });

  it('distinguishes account-storage retry from post-save reconnect retry', () => {
    const workspace = read('apps/web/components/editor/EditorWorkspace.tsx');
    const dialog = read('apps/web/components/editor/panels/OwnerShareDialog.tsx');

    expect(dialog).toContain("phase === 'retryable'");
    expect(workspace).toContain('Lash could not reach account storage.');
    expect(workspace).toContain('Your document was saved, but Lash could not reconnect to it.');
  });

  it('reports live comment counts to prevent silent adjunct loss', () => {
    const chat = read('apps/web/components/editor/panels/ChatPanel.tsx');

    expect(chat).toContain('onThreadCountChange?: (count: number) => void');
    expect(chat).toContain('onThreadCountChange?.(threads.length)');
  });

  it('lets trusted Yjs hydration target the committed remote document identity', () => {
    const workspace = read('apps/web/components/editor/EditorWorkspace.tsx');

    expect(workspace).toContain(
      'const mutationAuthorityDocumentId = realtimeEnabled\n' +
        '    ? resolution.remoteDocumentId\n' +
        '    : activeDocumentId;',
    );
    expect(workspace).toContain('documentId: mutationAuthorityDocumentId');
  });
});
