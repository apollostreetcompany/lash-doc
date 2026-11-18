import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

import {
  closeStalePublicSockets,
  type PublicSocketAttachment,
} from '../../../realtime-worker/src/room';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;

const publicAttachment = (cutoffGeneration: number): PublicSocketAttachment => ({
  protocolVersion: 4,
  hydrated: true,
  actorId: 'public-reader',
  roomId: ROOM_ID,
  capabilities: ['doc.read'],
  mode: 'read',
  policyVersion: 2,
  cutoffGeneration,
  browserOrigin: 'https://lash.example',
  connectedAt: Date.parse('2026-07-30T00:00:00.000Z'),
});

const socket = (attachment: unknown) => ({
  deserializeAttachment: vi.fn(() => attachment),
  close: vi.fn(),
});

describe('public policy cutoff', () => {
  it('closes active and hibernated stale public sockets while preserving owner v3', () => {
    const active = socket(publicAttachment(1));
    const hibernated = socket(publicAttachment(1));
    const current = socket({ ...publicAttachment(2), policyVersion: 3, mode: 'comment' });
    const owner = socket({
      protocolVersion: 3,
      hydrated: true,
      actorId: 'owner',
      roomId: ROOM_ID,
      capabilities: ['doc.read', 'doc.edit'],
      connectedAt: 1,
    });

    expect(
      closeStalePublicSockets([active, hibernated, current, owner] as never, {
        mode: 'comment',
        policyVersion: 3,
        cutoffGeneration: 2,
      }),
    ).toBe(2);
    expect(active.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
    expect(hibernated.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
    expect(current.close).not.toHaveBeenCalled();
    expect(owner.close).not.toHaveBeenCalled();
  });
});
