import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
  resolve(process.cwd(), 'apps/web/components/editor/EditorWorkspace.tsx'),
  'utf8',
);
const css = readFileSync(resolve(process.cwd(), 'apps/web/app/globals.css'), 'utf8');

describe('owner Share workspace integration contract', () => {
  it('freezes one exact current editor snapshot and retains its opaque attempt for retry', () => {
    expect(workspace).toContain('createBrowserDocumentPromotionAttempt');
    expect(workspace).toContain('promotionAttemptRef.current ??=');
    expect(workspace).toContain('body: editor.getJSON()');
    expect(workspace).toContain('localDocumentId: activeDocumentId');
    expect(workspace).toContain('comments: commentThreadCount');
    expect(workspace).toContain('suggestions: unresolvedSuggestionCount');
    expect(workspace).toContain('promoteOwnerDocument(attempt)');
  });

  it('keeps legacy loopback Share in the rail but removes Share from the normal rail', () => {
    expect(workspace).toContain("runtimeMode === 'development-loopback'");
    expect(workspace).toMatch(/runtimeMode === 'development-loopback'\s*\?\s*\(?\s*\[/u);
    expect(workspace).toContain('<OwnerShareDialog');
  });

  it('labels owners and named editors according to their distinct access', () => {
    expect(workspace).toContain("'Saved to your account'");
    expect(workspace).toContain("'Owner access'");
    expect(workspace).toContain("'Can edit'");
    expect(workspace).toMatch(/accessSnapshot\.authoritativeOwner/u);
  });

  it('provides a full-height narrow sheet with 44px actions and no viewport overflow', () => {
    expect(css).toMatch(/\.lash-owner-share-dialog\s*\{/su);
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.lash-owner-share-dialog[^{}]*\{[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;/u,
    );
    expect(css).toMatch(/\.lash-owner-share-primary\s*\{[^}]*min-height:\s*44px;/u);
  });
});
