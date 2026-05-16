import { suggestFallback } from '@lash/ai';
import { createDocumentId, type EditPatch } from '@lash/types';
import { describe, expect, it } from 'vitest';

const patch: EditPatch = {
  patchId: 'patch:fallback',
  docId: createDocumentId('ai-fallback-doc'),
  baseVersion: 'base-sha',
  schemaVersion: 'lash-schema-v1',
  author: { type: 'ai', id: 'ai-editor', label: 'AI Editor' },
  createdAt: '2026-05-16T05:32:00.000Z',
  operations: [{ op: 'replace_text', from: 0, to: 40, text: 'Rewrite everything.' }],
  rationale: 'Rewrite the full document.',
  allowGlobal: true,
};

describe('ai-fallback', () => {
  it('returns a no-op fallback patch for unconfirmed global edits', () => {
    const fallback = suggestFallback(patch, {
      ok: false,
      reason: 'doc-wide-without-confirm',
      details: 'Doc-wide edits require confirmation.',
    });

    expect(fallback).toMatchObject({
      patchId: 'patch:fallback:fallback',
      allowGlobal: false,
      operations: [{ op: 'replace_text', from: 0, to: 0, text: '' }],
    });
    expect(fallback?.rationale).toContain('No mutation was applied');
  });

  it('does not propose fallbacks for unsafe structural operations', () => {
    expect(
      suggestFallback(patch, {
        ok: false,
        reason: 'unsafe-op',
        details: 'pm_step replay is unavailable.',
      }),
    ).toBeNull();
  });
});
