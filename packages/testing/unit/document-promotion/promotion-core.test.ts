import { canonicalize } from '@lash/types';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DocumentPromotionConfigurationError,
  loadDocumentPromotionConfig,
} from '../../../../apps/web/lib/documentPromotion/config';
import {
  deriveDocumentPromotionIdempotencyHash,
  deriveDocumentRoomId,
} from '../../../../apps/web/lib/documentPromotion/crypto';
import {
  PROMOTION_LIMITS,
  parseBrowserPromotionRequest,
  parseCanonicalLocalDocumentId,
} from '../../../../apps/web/lib/documentPromotion/validation';

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const KEY_BASE64URL = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const IDEMPOTENCY_KEY = 'AAECAwQFBgcICQoLDA0ODw';

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('base64url');

const makeSnapshot = () => {
  const body = { type: 'doc', content: [{ type: 'paragraph' }] };
  const initialUpdate = Buffer.from([0, 0]).toString('base64');
  const bodySha256 = sha256(canonicalize(body));
  const initialUpdateSha256 = sha256(Buffer.from(initialUpdate, 'base64'));
  return {
    version: 1 as const,
    title: 'Weekly plan',
    body,
    bodySha256,
    initialUpdate,
    initialUpdateSha256,
    adjuncts: { comments: 0 as const, suggestions: 0 as const },
    snapshotSha256: sha256(
      canonicalize({
        version: 1,
        title: 'Weekly plan',
        bodySha256,
        initialUpdateSha256,
        adjuncts: { comments: 0, suggestions: 0 },
      }),
    ),
  };
};

describe('document promotion configuration', () => {
  it('loads one current and retained versioned derivation keys exactly', () => {
    const config = loadDocumentPromotionConfig({
      LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
      LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
      LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL},v0:${'A'.repeat(43)}`,
    });

    expect(config.workerOrigin).toBe('https://worker.example');
    expect(config.controlSecret).toBe('c'.repeat(32));
    expect(config.derivationKeys.map(({ version }) => version)).toEqual(['v1', 'v0']);
    expect(config.derivationKeys[0]?.key).toEqual(Buffer.alloc(32, 7));
  });

  it.each([
    {
      label: 'non-loopback HTTP',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'http://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL}`,
      },
    },
    {
      label: 'Worker path',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example/path',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL}`,
      },
    },
    {
      label: 'weak control secret',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(31),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL}`,
      },
    },
    {
      label: 'spaced key ring',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL}, v0:${KEY_BASE64URL}`,
      },
    },
    {
      label: 'duplicate version',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL},v1:${'A'.repeat(43)}`,
      },
    },
    {
      label: 'zero-padded derivation version',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v01:${KEY_BASE64URL}`,
      },
    },
    {
      label: 'oversized derivation version',
      environment: {
        LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v123456789:${KEY_BASE64URL}`,
      },
    },
  ])('rejects $label', ({ environment }) => {
    expect(() => loadDocumentPromotionConfig(environment)).toThrow(
      DocumentPromotionConfigurationError,
    );
  });

  it('permits HTTP only for loopback Worker origins', () => {
    expect(
      loadDocumentPromotionConfig({
        LASH_REALTIME_WORKER_HTTP_URL: 'http://127.0.0.1:8787',
        LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
        LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${KEY_BASE64URL}`,
      }).workerOrigin,
    ).toBe('http://127.0.0.1:8787');
  });

  it('accepts the exact bounded derivation-version endpoints', () => {
    const config = loadDocumentPromotionConfig({
      LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
      LASH_WORKER_CONTROL_SECRET_CURRENT: 'c'.repeat(32),
      LASH_DOCUMENT_ID_DERIVATION_KEYS: `v0:${KEY_BASE64URL},v99999999:${'A'.repeat(43)}`,
    });

    expect(config.derivationKeys.map(({ version }) => version)).toEqual(['v0', 'v99999999']);
  });
});

describe('document promotion identity derivation', () => {
  it('matches the frozen room and idempotency vectors', () => {
    const key = Buffer.alloc(32, 7);
    expect(deriveDocumentRoomId('v1', key, PRINCIPAL_ID, 'weekly-plan')).toBe(
      'doc-v1-fc67c0ba3b5afee772776560c554e181c590ae22cba47a55ddc90959fbcd0d61',
    );
    expect(
      deriveDocumentPromotionIdempotencyHash(
        PRINCIPAL_ID,
        'weekly-plan',
        Buffer.from(IDEMPOTENCY_KEY, 'base64url'),
      ),
    ).toBe('CEP7tIPvMCDbqIAWo2G_pusiw96XbnQpvEykR7M-LmY');
  });

  it.each(['', 'é', 'two words', '-leading', `${'a'.repeat(129)}`])(
    'rejects an invalid local identifier %j',
    (localDocumentId) => {
      expect(() => parseCanonicalLocalDocumentId(localDocumentId)).toThrow();
    },
  );
});

describe('browser promotion request validation', () => {
  it('accepts the exact closed snapshot and canonicalizes its JSON body', async () => {
    const result = await parseBrowserPromotionRequest(
      JSON.stringify({
        version: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        snapshot: makeSnapshot(),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotencyKey).toEqual(Buffer.from(IDEMPOTENCY_KEY, 'base64url'));
      expect(result.snapshot.body).toEqual({
        content: [{ type: 'paragraph' }],
        type: 'doc',
      });
    }
  });

  it.each([
    {
      label: 'unknown field',
      mutate: (value: Record<string, unknown>) => ({ ...value, ownerPrincipalId: PRINCIPAL_ID }),
    },
    {
      label: 'short idempotency key',
      mutate: (value: Record<string, unknown>) => ({ ...value, idempotencyKey: 'AA' }),
    },
    {
      label: 'nonzero adjunct',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        snapshot: {
          ...(value.snapshot as Record<string, unknown>),
          adjuncts: { comments: 1, suggestions: 0 },
        },
      }),
    },
    {
      label: 'wrong body hash',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        snapshot: {
          ...(value.snapshot as Record<string, unknown>),
          bodySha256: 'x'.repeat(43),
        },
      }),
    },
    {
      label: 'decomposed title',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        snapshot: {
          ...(value.snapshot as Record<string, unknown>),
          title: 'Cafe\u0301',
        },
      }),
    },
  ])('rejects a payload with $label', async ({ mutate }) => {
    const value = mutate({
      version: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      snapshot: makeSnapshot(),
    });
    await expect(parseBrowserPromotionRequest(JSON.stringify(value))).resolves.toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('rejects duplicate JSON fields without imposing canonical wire ordering', async () => {
    const raw = JSON.stringify({
      version: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      snapshot: makeSnapshot(),
    });
    const duplicate = raw.replace('"version":1', '"version":1,"version":1');
    await expect(parseBrowserPromotionRequest(duplicate)).resolves.toEqual({
      ok: false,
      error: 'invalid-request',
    });

    const reordered = JSON.stringify({
      snapshot: makeSnapshot(),
      idempotencyKey: IDEMPOTENCY_KEY,
      version: 1,
    });
    await expect(parseBrowserPromotionRequest(reordered)).resolves.toMatchObject({ ok: true });
  });

  it('rejects payload, title, body, and decoded update limit overflows', async () => {
    expect(Buffer.byteLength('x'.repeat(PROMOTION_LIMITS.requestBytes + 1))).toBeGreaterThan(
      PROMOTION_LIMITS.requestBytes,
    );
    await expect(
      parseBrowserPromotionRequest('x'.repeat(PROMOTION_LIMITS.requestBytes + 1)),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });

    const snapshot = makeSnapshot();
    const oversizedTitle = { ...snapshot, title: 'x'.repeat(PROMOTION_LIMITS.titleBytes + 1) };
    await expect(
      parseBrowserPromotionRequest(
        JSON.stringify({
          version: 1,
          idempotencyKey: IDEMPOTENCY_KEY,
          snapshot: oversizedTitle,
        }),
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });

    const oversizedBody = {
      type: 'doc',
      content: [],
      padding: 'x'.repeat(PROMOTION_LIMITS.bodyCanonicalBytes),
    };
    await expect(
      parseBrowserPromotionRequest(
        JSON.stringify({
          version: 1,
          idempotencyKey: IDEMPOTENCY_KEY,
          snapshot: { ...snapshot, body: oversizedBody },
        }),
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });

    const oversizedUpdate = Buffer.alloc(PROMOTION_LIMITS.initialUpdateBytes + 1).toString(
      'base64',
    );
    await expect(
      parseBrowserPromotionRequest(
        JSON.stringify({
          version: 1,
          idempotencyKey: IDEMPOTENCY_KEY,
          snapshot: { ...snapshot, initialUpdate: oversizedUpdate },
        }),
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });
  });
});
