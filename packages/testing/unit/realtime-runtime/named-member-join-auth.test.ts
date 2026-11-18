import { describe, expect, it, vi } from 'vitest';

const providerState = vi.hoisted(() => ({ configured: true }));

vi.mock('../../../../apps/web/lib/auth/config', () => ({
  loadSupabaseAuthConfig: () => ({
    status: providerState.configured ? 'configured' : 'unavailable',
  }),
}));

import CheckEmailPage from '../../../../apps/web/app/auth/check-email/page';
import SignInPage from '../../../../apps/web/app/auth/sign-in/page';
import { completeEmailSignIn } from '../../../../apps/web/lib/auth/callback';
import { createAuthRequestState } from '../../../../apps/web/lib/auth/requestState';
import { authCallbackUrl, safeDocumentReturnPath } from '../../../../apps/web/lib/auth/returnUrl';
import { renderToStaticMarkup } from '../../../../apps/web/node_modules/react-dom/server';

const origin = 'https://lash.example';
const roomId = `doc-v1-${'a'.repeat(64)}`;
const joinPath = `/join/${roomId}`;
const principalKey = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-11-18T02:00:00.000Z');

describe('named invitation account return', () => {
  it('accepts a canonical join path and excludes any bearer or other search data', () => {
    expect(safeDocumentReturnPath(joinPath, origin)).toBe(joinPath);
    expect(safeDocumentReturnPath(`${origin}${joinPath}`, origin)).toBe(joinPath);

    for (const candidate of [
      `${joinPath}#invite=${'b'.repeat(43)}`,
      `${joinPath}?invite=${'b'.repeat(43)}`,
      `${joinPath}?`,
      `${joinPath}/`,
      `${joinPath}%2fextra`,
      `/join/../join/${roomId}`,
      `/join/doc-v01-${'a'.repeat(64)}`,
      `/join/doc-v1-${'A'.repeat(64)}`,
      `https://example.invalid${joinPath}`,
      `https://someone@lash.example${joinPath}`,
    ]) {
      expect(safeDocumentReturnPath(candidate, origin)).toBeNull();
    }
  });

  it('binds the verified magic link to the exact join path without a bearer', async () => {
    const requestState = createAuthRequestState(joinPath, origin, principalKey, {
      now,
      randomBytes: () => Buffer.alloc(32, 7),
    });
    const callback = authCallbackUrl(joinPath, origin, requestState.state);
    expect([...callback.searchParams.entries()]).toEqual([
      ['next', joinPath],
      ['state', requestState.state],
    ]);

    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'provider-subject',
          email: 'recipient@example.com',
          email_confirmed_at: '2026-11-18T01:00:00.000Z',
        },
      },
      error: null,
    });
    const input = {
      authRequestCookie: requestState.cookieValue,
      next: joinPath,
      now,
      siteOrigin: origin,
      state: requestState.state,
      tokenHash: 'one-time-token-hash',
      type: 'email',
    };
    const provider = { issuer: 'https://project.supabase.co/auth/v1', principalKey };
    const client = { auth: { verifyOtp, getUser } } as never;
    await expect(
      completeEmailSignIn({ ...input, next: `/doc/${roomId}` }, client, provider),
    ).resolves.toEqual({ status: 'invalid-link', documentPath: null });
    expect(verifyOtp).not.toHaveBeenCalled();
    await expect(completeEmailSignIn(input, client, provider)).resolves.toEqual({
      status: 'authenticated',
      documentPath: joinPath,
    });
  });

  it('makes clear which email to use and sends readers back to the invitation', async () => {
    const props = { searchParams: Promise.resolve({ next: joinPath }) };
    const signIn = renderToStaticMarkup(await SignInPage(props));
    expect(signIn).toContain('Sign in to accept the invitation');
    expect(signIn).toContain('Use the email address the invitation was sent to.');
    expect(signIn).toContain(`name="next" value="${joinPath}"`);
    expect(signIn).toContain('Return to invitation');
    expect(signIn).not.toContain('Your account owns shared documents');

    const checkEmail = renderToStaticMarkup(await CheckEmailPage(props));
    expect(checkEmail).toContain('returns you to the invitation');
    expect(checkEmail).toContain('Return to invitation');
  });
});
