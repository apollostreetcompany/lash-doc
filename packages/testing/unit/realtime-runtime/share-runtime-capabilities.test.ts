import { describe, expect, it } from 'vitest';

import { runtimeShareCapabilities } from '../../../../apps/web/components/editor/panels/SharePanel';

describe('share runtime capabilities', () => {
  it.each(['view', 'comment', 'suggest'] as const)(
    'does not advertise product-RBAC mutations for a read-only %s runtime grant',
    (scope) => {
      expect(runtimeShareCapabilities(scope, false)).toEqual({
        canAccept: false,
        canComment: false,
        canEdit: false,
        canSuggest: false,
      });
    },
  );

  it('preserves edit-runtime capability semantics', () => {
    expect(runtimeShareCapabilities('edit', true)).toMatchObject({
      canComment: true,
      canEdit: true,
      canSuggest: true,
    });
  });
});
