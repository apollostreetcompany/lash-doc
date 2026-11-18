import { describe, expect, it, vi } from 'vitest';

import { readPublicAccessState } from '../../../../apps/web/lib/documentPublicAccess/browserClient';
import {
  handleDocumentPublicAccess,
  type DocumentPublicAccessRouteDependencies,
} from '../../../../apps/web/lib/documentPublicAccess/routeHandler';
import type { PublicPolicyManagementSuccessV1 } from '../../../../apps/web/lib/documentPublicAccess/types';
import {
  parsePublicAccessPatchBody,
  parsePublicPolicyManagementResult,
} from '../../../../apps/web/lib/documentPublicAccess/validation';
import { callWorkerPublicPolicy } from '../../../../apps/web/lib/documentPublicAccess/workerClient';
import { NextRequest } from '../../../../apps/web/node_modules/next/server.js';

vi.mock('../../../../apps/web/node_modules/server-only/index.js', () => ({}));

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = `claim-v1-${'b'.repeat(64)}`;
const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const LOCAL_ID = 'fresh-account-handoff';
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174001';
const SECRET = 'worker-control-secret-with-at-least-32-bytes';

describe('document public-access web boundary', () => {
  it('parses only the exact restricted/read/comment update vocabulary', () => {
    for (const mode of ['restricted', 'read', 'comment'] as const) {
      expect(
        parsePublicAccessPatchBody(
          JSON.stringify({
            version: 1,
            mode,
            expectedPolicyVersion: 1,
            mutationId: MUTATION_ID,
          }),
        ),
      ).toEqual({
        ok: true,
        request: {
          version: 1,
          mode,
          expectedPolicyVersion: 1,
          mutationId: MUTATION_ID,
        },
      });
    }
    for (const body of [
      { version: 1, mode: 'edit', expectedPolicyVersion: 1, mutationId: MUTATION_ID },
      { version: 1, mode: null, expectedPolicyVersion: 1, mutationId: MUTATION_ID },
      { version: 1, mode: 'read', expectedPolicyVersion: 0, mutationId: MUTATION_ID },
      {
        version: 1,
        mode: 'read',
        expectedPolicyVersion: 1,
        mutationId: MUTATION_ID,
        capability: 'doc.edit',
      },
    ]) {
      expect(parsePublicAccessPatchBody(JSON.stringify(body))).toEqual({ ok: false });
    }
  });

  it('carries projection blocks only as a literal flag paired with a null path', async () => {
    const blocked = {
      ok: true,
      version: 1,
      claimId: CLAIM_ID,
      roomId: ROOM_ID,
      ownerPrincipalId: PRINCIPAL,
      mode: 'read',
      policyVersion: 3,
      cutoffGeneration: 2,
      publicPath: null,
      publicProjectionBlocked: true,
    };
    const expected = {
      claimId: CLAIM_ID,
      ownerPrincipalId: PRINCIPAL,
      operation: 'read' as const,
    };
    expect(parsePublicPolicyManagementResult(blocked, 200, expected)).toEqual(blocked);
    expect(
      parsePublicPolicyManagementResult(
        { ...blocked, publicProjectionBlocked: false },
        200,
        expected,
      ),
    ).toBeNull();
    expect(
      parsePublicPolicyManagementResult(
        { ...blocked, publicPath: `/public/${ROOM_ID}` },
        200,
        expected,
      ),
    ).toBeNull();
    expect(
      parsePublicPolicyManagementResult({ ...blocked, mode: 'restricted', changed: true }, 200, {
        ...expected,
        operation: 'update',
      }),
    ).toMatchObject({ mode: 'restricted', publicPath: null, publicProjectionBlocked: true });

    const browserState = {
      mode: 'read',
      policyVersion: 3,
      cutoffGeneration: 2,
      publicUrl: null,
      publicProjectionBlocked: true,
    };
    for (const response of [
      Response.json({ ok: true, version: 1, state: browserState }),
      Response.json(
        {
          ok: false,
          version: 1,
          error: 'public-projection-blocked',
          retryable: false,
          state: browserState,
        },
        { status: 409 },
      ),
    ]) {
      await expect(
        readPublicAccessState({
          localDocumentId: LOCAL_ID,
          expectedOrigin: 'https://lash.test',
          fetcher: vi.fn(async () => response),
        }),
      ).resolves.toMatchObject({ state: browserState });
    }
  });

  it('returns a blocked update conflict only after an authenticated Worker readback', async () => {
    const siteOrigin = 'https://lash.test';
    const refreshed: PublicPolicyManagementSuccessV1 = {
      ok: true,
      version: 1,
      claimId: CLAIM_ID,
      ownerPrincipalId: PRINCIPAL,
      roomId: ROOM_ID,
      mode: 'read',
      policyVersion: 3,
      cutoffGeneration: 2,
      publicPath: null,
      publicProjectionBlocked: true,
    };
    const callWorker = vi
      .fn<DocumentPublicAccessRouteDependencies['callWorker']>()
      .mockResolvedValueOnce({ ok: false, version: 1, error: 'not-shareable', retryable: false })
      .mockResolvedValueOnce(refreshed);
    const dependencies = {
      requireAuthConfig: () => ({
        siteOrigin,
        url: 'https://auth.test',
        issuer: 'https://auth.test/auth/v1',
        publishableKey: 'test-key',
      }),
      requirePrincipal: async () => ({
        id: PRINCIPAL,
        kind: 'account' as const,
        email: 'owner@example.test',
        emailVerifiedAt: '2026-11-18T00:00:00.000Z',
      }),
      createSession: () => ({
        client: {} as ReturnType<DocumentPublicAccessRouteDependencies['createSession']>['client'],
        applyTo: (response) => response,
      }),
      loadWorkerConfig: () => ({
        workerOrigin: 'https://worker.test',
        controlSecret: SECRET,
        derivationKeys: [],
      }),
      deriveClaimId: () => CLAIM_ID,
      callWorker,
    } satisfies DocumentPublicAccessRouteDependencies;
    const request = new NextRequest(
      `${siteOrigin}/api/documents/${LOCAL_ID}/settings/public-access`,
      {
        method: 'PATCH',
        headers: {
          host: 'lash.test',
          origin: siteOrigin,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          mode: 'comment',
          expectedPolicyVersion: 3,
          mutationId: MUTATION_ID,
        }),
      },
    );
    const result = await handleDocumentPublicAccess(
      request,
      { localDocumentId: LOCAL_ID },
      dependencies,
    );
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'public-projection-blocked',
      retryable: false,
      state: {
        mode: 'read',
        policyVersion: 3,
        cutoffGeneration: 2,
        publicUrl: null,
        publicProjectionBlocked: true,
      },
    });
    expect(callWorker.mock.calls.map(([call]) => call.operation)).toEqual(['update', 'read']);
  });

  it('signs an exact owner-policy read and accepts only its bound readback', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        `/api/management/document-claims/${CLAIM_ID}/public-policy/read`,
      );
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toMatch(/^Lash-Control v2:/u);
      expect(request.headers.get('x-lash-control-principal-id')).toBe(PRINCIPAL);
      await expect(request.json()).resolves.toEqual({
        version: 1,
        claimId: CLAIM_ID,
        ownerPrincipalId: PRINCIPAL,
        localDocumentId: LOCAL_ID,
      });
      return Response.json({
        ok: true,
        version: 1,
        claimId: CLAIM_ID,
        roomId: ROOM_ID,
        ownerPrincipalId: PRINCIPAL,
        mode: 'restricted',
        policyVersion: 1,
        cutoffGeneration: 0,
        publicPath: null,
      });
    });

    await expect(
      callWorkerPublicPolicy(
        {
          workerOrigin: 'https://worker.test',
          controlSecret: SECRET,
          operation: 'read',
          request: {
            version: 1,
            claimId: CLAIM_ID,
            ownerPrincipalId: PRINCIPAL,
            localDocumentId: LOCAL_ID,
          },
        },
        {
          fetchImpl: fetchImpl as typeof fetch,
          now: () => new Date('2026-07-30T00:00:00.000Z'),
          randomUUID: () => REQUEST_ID,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      mode: 'restricted',
      policyVersion: 1,
      publicPath: null,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends only the exact update vocabulary and rejects a forged readback', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        `/api/management/document-claims/${CLAIM_ID}/public-policy/update`,
      );
      await expect(request.json()).resolves.toEqual({
        version: 1,
        claimId: CLAIM_ID,
        ownerPrincipalId: PRINCIPAL,
        localDocumentId: LOCAL_ID,
        mode: 'comment',
        expectedPolicyVersion: 1,
        mutationId: MUTATION_ID,
      });
      return Response.json({
        ok: true,
        version: 1,
        claimId: CLAIM_ID,
        roomId: ROOM_ID,
        ownerPrincipalId: PRINCIPAL,
        mode: 'comment',
        policyVersion: 2,
        cutoffGeneration: 1,
        publicPath: `/public/${ROOM_ID}`,
        changed: true,
        capabilities: ['doc.edit'],
      });
    });

    await expect(
      callWorkerPublicPolicy(
        {
          workerOrigin: 'https://worker.test',
          controlSecret: SECRET,
          operation: 'update',
          request: {
            version: 1,
            claimId: CLAIM_ID,
            ownerPrincipalId: PRINCIPAL,
            localDocumentId: LOCAL_ID,
            mode: 'comment',
            expectedPolicyVersion: 1,
            mutationId: MUTATION_ID,
          },
        },
        {
          fetchImpl: fetchImpl as typeof fetch,
          now: () => new Date('2026-07-30T00:00:00.000Z'),
          randomUUID: () => REQUEST_ID,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'internal-error',
      retryable: true,
    });
  });

  it('rejects public paths that are only a canonical-looking prefix', async () => {
    const failure = {
      ok: false,
      version: 1,
      error: 'policy-conflict',
      retryable: false,
      state: {
        mode: 'comment',
        policyVersion: 2,
        cutoffGeneration: 1,
        publicPath: '/public/doc-v-not-a-room',
      },
    };
    expect(
      parsePublicPolicyManagementResult(failure, 409, {
        claimId: CLAIM_ID,
        ownerPrincipalId: PRINCIPAL,
        operation: 'update',
      }),
    ).toBeNull();

    await expect(
      readPublicAccessState({
        localDocumentId: LOCAL_ID,
        expectedOrigin: 'https://lash.test',
        fetcher: vi.fn(async () =>
          Response.json({
            ok: true,
            version: 1,
            state: {
              mode: 'comment',
              policyVersion: 2,
              cutoffGeneration: 1,
              publicUrl: 'https://lash.test/public/doc-v-not-a-room?credential=leak',
            },
          }),
        ) as typeof fetch,
      }),
    ).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'temporarily-unavailable',
      retryable: true,
    });
  });
});
