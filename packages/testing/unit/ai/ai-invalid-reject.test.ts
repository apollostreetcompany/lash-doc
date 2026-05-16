import { validateEditPatch } from '@lash/ai';
import { createDocumentId, type EditPatch, type EditorOp } from '@lash/types';
import { describe, expect, it } from 'vitest';

const docId = createDocumentId('ai-invalid-doc');

const patch = (operations: EditorOp[]): EditPatch => ({
  patchId: 'patch:invalid',
  docId,
  baseVersion: 'base-sha',
  schemaVersion: 'lash-schema-v1',
  author: { type: 'ai', id: 'ai-editor', label: 'AI Editor' },
  createdAt: '2026-05-16T05:31:00.000Z',
  operations,
  rationale: 'Try an unsafe structural change.',
});

const options = {
  baseDoc: { text: 'A rough draft' },
  selection: { from: 2, to: 7 },
  schemaSummary: { nodeTypes: ['doc', 'paragraph'], markTypes: ['bold'] },
  confirmations: {},
};

describe('ai-invalid-reject', () => {
  it('rejects schema-breaking insert_node operations', () => {
    const result = validateEditPatch(
      patch([{ op: 'insert_node', pos: 4, node: { type: 'unsupported_widget' } }]),
      options,
    );

    expect(result).toMatchObject({ ok: false, reason: 'schema-invalid' });
  });

  it('rejects opaque pm_step operations until a schema registry can replay them', () => {
    const result = validateEditPatch(patch([{ op: 'pm_step', step: { stepType: 'replace' } }]), {
      ...options,
      selection: { from: 0, to: 20 },
    });

    expect(result).toMatchObject({ ok: false, reason: 'unsafe-op' });
  });
});
