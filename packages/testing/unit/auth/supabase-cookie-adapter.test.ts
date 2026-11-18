import { describe, expect, it, vi } from 'vitest';

import { createSupabaseCookieAdapter } from '../../../../apps/web/lib/auth/cookies';

describe('@supabase/ssr cookie adapter isolation', () => {
  it('implements the beta getAll/setAll boundary without inventing cookie state', () => {
    const set = vi.fn();
    const setHeader = vi.fn();
    const adapter = createSupabaseCookieAdapter({
      getAll: () => [
        { name: 'sb-access-token', value: 'access' },
        { name: 'sb-refresh-token', value: 'refresh' },
      ],
      set,
      setHeader,
    });

    expect(adapter.getAll()).toEqual([
      { name: 'sb-access-token', value: 'access' },
      { name: 'sb-refresh-token', value: 'refresh' },
    ]);

    adapter.setAll?.(
      [
        {
          name: 'sb-access-token',
          value: 'updated',
          options: { httpOnly: true, sameSite: 'lax', secure: true },
        },
      ],
      {
        'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
      },
    );

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      'sb-access-token',
      'updated',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
      }),
    );
    expect(setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-cache, no-store, must-revalidate, max-age=0',
    );
  });
});
