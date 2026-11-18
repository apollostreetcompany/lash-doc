import { describe, expect, it } from 'vitest';

import { deriveDocumentClaimId } from '../../../realtime-worker/src/documentClaim';
import {
  canonicalPublicCommentBody,
  parsePublicCommentCreateRequest,
  parsePublicCommentListRequest,
  parsePublicCommentModerationRequest,
} from '../../../realtime-worker/src/publicComment';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PRINCIPAL = `account:v1:${'p'.repeat(43)}`;

describe('public comment request domain', () => {
  it('exact-parses list and verified create without granting reply or document mutation', () => {
    expect(
      parsePublicCommentListRequest(
        {
          version: 1,
          roomId: ROOM_ID,
          expectedPolicyVersion: 3,
          expectedCutoffGeneration: 2,
          beforeSequence: null,
          limit: 50,
          rateKey: `rate-v1-${'r'.repeat(43)}`,
        },
        ROOM_ID,
      ),
    ).toMatchObject({ ok: true });
    const create = parsePublicCommentCreateRequest(
      {
        version: 1,
        roomId: ROOM_ID,
        commenterPrincipalId: PRINCIPAL,
        commenterAlias: 'Commenter A1b_2-',
        mutationId: '123e4567-e89b-42d3-a456-426614174000',
        expectedPolicyVersion: 3,
        expectedCutoffGeneration: 2,
        body: 'Public note',
      },
      ROOM_ID,
      PRINCIPAL,
    );
    expect(create).toMatchObject({ ok: true });
    expect(JSON.stringify(create)).not.toMatch(
      /reply|edit|suggest|share|settings|history|ai|claim|owner/iu,
    );
  });

  it('verifies that the body is already canonical and rejects unsafe Unicode or limits', () => {
    expect(canonicalPublicCommentBody('Cafe\u0301\r\n line ')).toEqual({
      ok: true,
      body: 'Café\n line',
    });
    for (const body of [
      'Cafe\u0301',
      'line\rbreak',
      ' outer ',
      '',
      '\u0000',
      '\u0085',
      '\ud800',
      'x'.repeat(2001),
      `${'x\n'.repeat(20)}x`,
      '🙂'.repeat(1025),
    ]) {
      expect(
        parsePublicCommentCreateRequest(
          {
            version: 1,
            roomId: ROOM_ID,
            commenterPrincipalId: PRINCIPAL,
            commenterAlias: 'Commenter A1b_2-',
            mutationId: '123e4567-e89b-42d3-a456-426614174000',
            expectedPolicyVersion: 3,
            expectedCutoffGeneration: 2,
            body,
          },
          ROOM_ID,
          PRINCIPAL,
        ),
      ).toEqual({ ok: false, error: 'invalid-request' });
    }
  });

  it('rejects extra keys, wrong rooms, forged principals, cursors, aliases, and limits', () => {
    const list = {
      version: 1,
      roomId: ROOM_ID,
      expectedPolicyVersion: 3,
      expectedCutoffGeneration: 2,
      beforeSequence: null,
      limit: 50,
      rateKey: `rate-v1-${'r'.repeat(43)}`,
    };
    expect(parsePublicCommentListRequest({ ...list, limit: 49 }, ROOM_ID)).toMatchObject({
      ok: false,
    });
    expect(parsePublicCommentListRequest({ ...list, extra: true }, ROOM_ID)).toMatchObject({
      ok: false,
    });
    expect(
      parsePublicCommentCreateRequest(
        {
          version: 1,
          roomId: ROOM_ID,
          commenterPrincipalId: `account:v1:${'q'.repeat(43)}`,
          commenterAlias: 'Commenter too-long',
          mutationId: 'not-uuid',
          expectedPolicyVersion: 0,
          expectedCutoffGeneration: -1,
          body: 'note',
        },
        ROOM_ID,
        PRINCIPAL,
      ),
    ).toMatchObject({ ok: false });
  });

  it('recomputes and principal-binds the exact owner hide envelope', async () => {
    const owner = `account:v1:${'o'.repeat(43)}`;
    const claimId = await deriveDocumentClaimId(owner, 'doc-alpha');
    const request = {
      version: 1,
      claimId,
      ownerPrincipalId: owner,
      localDocumentId: 'doc-alpha',
      commentId: 'pc-v1-323e4567-e89b-42d3-a456-426614174000',
      action: 'hide',
      mutationId: '923e4567-e89b-42d3-a456-426614174000',
      expectedPolicyVersion: 3,
      expectedCutoffGeneration: 2,
    };
    await expect(
      parsePublicCommentModerationRequest(request, claimId, owner),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      parsePublicCommentModerationRequest(
        { ...request, ownerPrincipalId: PRINCIPAL },
        claimId,
        owner,
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });
  });
});
