import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('account-owner Share UI contract', () => {
  it('distinguishes account-storage retry from post-save reconnect retry', () => {
    const workspace = read('apps/web/components/editor/EditorWorkspace.tsx');
    const dialog = read('apps/web/components/editor/panels/OwnerShareDialog.tsx');

    expect(dialog).toContain("phase === 'retryable'");
    expect(workspace).toContain('Lash could not reach account storage.');
    expect(workspace).toContain('Your document was saved, but Lash could not reconnect to it.');
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
