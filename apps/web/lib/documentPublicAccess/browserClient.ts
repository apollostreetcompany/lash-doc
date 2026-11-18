import type { PublicAccessBrowserResultV1, PublicAccessMode, PublicAccessStateV1 } from './types';
import { hasValidPublicProjection, isPublicAccessMode } from './validation';

const DOCUMENT_ROOM_PATH = /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const parseState = (value: unknown, expectedOrigin: string): PublicAccessStateV1 | null => {
  if (
    !isPlainObject(value) ||
    !hasValidPublicProjection(value, 'publicUrl', [
      'mode',
      'policyVersion',
      'cutoffGeneration',
      'publicUrl',
    ]) ||
    !isPublicAccessMode(value.mode) ||
    !Number.isSafeInteger(value.policyVersion) ||
    Number(value.policyVersion) <= 0 ||
    !Number.isSafeInteger(value.cutoffGeneration) ||
    Number(value.cutoffGeneration) < 0 ||
    (value.publicUrl !== null && typeof value.publicUrl !== 'string')
  ) {
    return null;
  }
  if (typeof value.publicUrl === 'string') {
    try {
      const url = new URL(value.publicUrl);
      if (
        url.origin !== expectedOrigin ||
        !DOCUMENT_ROOM_PATH.test(url.pathname) ||
        url.search !== '' ||
        url.hash !== '' ||
        url.username !== '' ||
        url.password !== ''
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return value as unknown as PublicAccessStateV1;
};

const parseBrowserResult = (
  value: unknown,
  status: number,
  expectedOrigin: string,
): PublicAccessBrowserResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    const hasChanged = Object.prototype.hasOwnProperty.call(value, 'changed');
    if (
      status !== 200 ||
      !exactKeys(
        value,
        hasChanged ? ['ok', 'version', 'state', 'changed'] : ['ok', 'version', 'state'],
      ) ||
      (hasChanged && typeof value.changed !== 'boolean')
    ) {
      return null;
    }
    const state = parseState(value.state, expectedOrigin);
    return state
      ? {
          ok: true,
          version: 1,
          state,
          ...(hasChanged ? { changed: value.changed as boolean } : {}),
        }
      : null;
  }
  const hasState = Object.prototype.hasOwnProperty.call(value, 'state');
  if (
    !exactKeys(
      value,
      hasState
        ? ['ok', 'version', 'error', 'retryable', 'state']
        : ['ok', 'version', 'error', 'retryable'],
    ) ||
    ![
      'invalid-request',
      'unauthenticated',
      'document-unavailable',
      'policy-conflict',
      'public-projection-blocked',
      'temporarily-unavailable',
    ].includes(String(value.error)) ||
    typeof value.retryable !== 'boolean' ||
    (value.error === 'public-projection-blocked' && (status !== 409 || value.retryable))
  ) {
    return null;
  }
  const state = hasState ? parseState(value.state, expectedOrigin) : undefined;
  if (
    (hasState && !state) ||
    (value.error === 'public-projection-blocked' && !state?.publicProjectionBlocked)
  )
    return null;
  return {
    ok: false,
    version: 1,
    error: value.error as Extract<PublicAccessBrowserResultV1, { ok: false }>['error'],
    retryable: value.retryable,
    ...(state ? { state } : {}),
  };
};

const readJson = async (response: Response) => {
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    return null;
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
};

export const readPublicAccessState = async (input: {
  localDocumentId: string;
  expectedOrigin: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PublicAccessBrowserResultV1> => {
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(
      `/api/documents/${encodeURIComponent(input.localDocumentId)}/settings/public-access`,
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: input.signal,
      },
    );
    const value = await readJson(response);
    return (
      parseBrowserResult(value, response.status, input.expectedOrigin) ?? {
        ok: false,
        version: 1,
        error: 'temporarily-unavailable',
        retryable: true,
      }
    );
  } catch {
    return {
      ok: false,
      version: 1,
      error: 'temporarily-unavailable',
      retryable: true,
    };
  }
};

export const updatePublicAccessState = async (input: {
  localDocumentId: string;
  mode: PublicAccessMode;
  expectedPolicyVersion: number;
  mutationId: string;
  expectedOrigin: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PublicAccessBrowserResultV1> => {
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(
      `/api/documents/${encodeURIComponent(input.localDocumentId)}/settings/public-access`,
      {
        method: 'PATCH',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          mode: input.mode,
          expectedPolicyVersion: input.expectedPolicyVersion,
          mutationId: input.mutationId,
        }),
        signal: input.signal,
      },
    );
    const value = await readJson(response);
    return (
      parseBrowserResult(value, response.status, input.expectedOrigin) ?? {
        ok: false,
        version: 1,
        error: 'temporarily-unavailable',
        retryable: true,
      }
    );
  } catch {
    return {
      ok: false,
      version: 1,
      error: 'temporarily-unavailable',
      retryable: true,
    };
  }
};
