import { describe, expect, it } from 'vitest';

import { authCallbackUrl, safeDocumentReturnPath } from '../../../../apps/web/lib/auth/returnUrl';

describe('auth document return URL', () => {
  const origin = 'http://127.0.0.1:3000';

  it('preserves the exact same-origin document path and query', () => {
    expect(safeDocumentReturnPath('/doc/weekly-plan?realtime=on', origin)).toBe(
      '/doc/weekly-plan?realtime=on',
    );
    expect(
      safeDocumentReturnPath('http://127.0.0.1:3000/doc/weekly-plan?realtime=on', origin),
    ).toBe('/doc/weekly-plan?realtime=on');
  });

  it.each([
    'https://attacker.example/doc/weekly-plan',
    '//attacker.example/doc/weekly-plan',
    '/auth/confirm',
    '/doc/',
    '/doc/one/two',
    '/doc/weekly-plan#invite=bearer',
    'javascript:alert(1)',
  ])('rejects an unsafe or non-document return target: %s', (candidate) => {
    expect(safeDocumentReturnPath(candidate, origin)).toBeNull();
  });

  it('builds a configured-origin callback bound to state and the validated document path', () => {
    expect(
      authCallbackUrl('/doc/weekly-plan?realtime=on', origin, 'request-state').toString(),
    ).toBe(
      'http://127.0.0.1:3000/auth/confirm?next=%2Fdoc%2Fweekly-plan%3Frealtime%3Don&state=request-state',
    );
  });
});
