import { isWithinSelection, validateEditPatch } from '@lash/ai';
import { createDocumentId, type EditPatch, type EditorOp } from '@lash/types';
import { describe, expect, it } from 'vitest';

const docId = createDocumentId('ai-scope-doc');

const patch = (operations: EditorOp[]): EditPatch => ({
  patchId: 'patch:scope',
  docId,
  baseVersion: 'base-sha',
  schemaVersion: 'lash-schema-v1',
  author: { type: 'ai', id: 'ai-editor', label: 'AI Editor' },
  createdAt: '2026-05-16T05:30:00.000Z',
  operations,
  rationale: 'Tighten selected wording.',
});

describe('ai-scope-selection', () => {
  it('accepts only operations contained by the selected text range', () => {
    const selection = { from: 4, to: 12 };

    expect(
      isWithinSelection([{ op: 'replace_text', from: 5, to: 10, text: 'clear' }], selection),
    ).toBe(true);
    expect(isWithinSelection([{ op: 'delete_range', from: 0, to: 3 }], selection)).toBe(false);
    expect(
      isWithinSelection([{ op: 'insert_node', pos: 13, node: { type: 'paragraph' } }], selection),
    ).toBe(false);
  });

  it('validates selection-scoped AI patches and rejects unconfirmed global edits', () => {
    const valid = validateEditPatch(
      patch([{ op: 'replace_text', from: 4, to: 12, text: 'clear' }]),
      {
        baseDoc: { text: 'A very rough draft' },
        selection: { from: 4, to: 12 },
        schemaSummary: { nodeTypes: ['doc', 'paragraph'], markTypes: ['bold'] },
        confirmations: {},
      },
    );
    expect(valid).toEqual({ ok: true });

    const globalPatch = {
      ...patch([{ op: 'replace_text', from: 0, to: 18, text: 'A clearer draft' }]),
      allowGlobal: true,
    };
    const rejected = validateEditPatch(globalPatch, {
      baseDoc: { text: 'A very rough draft' },
      selection: { from: 4, to: 12 },
      schemaSummary: { nodeTypes: ['doc', 'paragraph'], markTypes: ['bold'] },
      confirmations: {},
    });
    expect(rejected).toMatchObject({ ok: false, reason: 'doc-wide-without-confirm' });
  });
});
