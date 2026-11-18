import type { CookieMethodsServer, CookieOptions } from '@supabase/ssr';

export interface SupabaseCookieAdapterSource {
  getAll: () => { name: string; value: string }[];
  set: (name: string, value: string, options: CookieOptions) => void;
  setHeader: (name: string, value: string) => void;
}

interface SupabaseResponseMutationTarget {
  cookies: {
    set(options: { name: string; value: string } & CookieOptions): void;
  };
  headers: {
    append(name: string, value: string): void;
    set(name: string, value: string): void;
  };
}

export function createSupabaseResponseMutationSink({
  getAll,
}: Pick<SupabaseCookieAdapterSource, 'getAll'>) {
  const cookies: Array<{ name: string; options: CookieOptions; value: string }> = [];
  const headers: Array<[name: string, value: string]> = [];
  const adapter = createSupabaseCookieAdapter({
    getAll,
    set: (name, value, options) => {
      cookies.push({ name, options: { ...options }, value });
    },
    setHeader: (name, value) => {
      headers.push([name, value]);
    },
  });

  return {
    adapter,
    applyTo: <Response extends SupabaseResponseMutationTarget>(response: Response): Response => {
      for (const cookie of cookies) {
        response.cookies.set({
          ...cookie.options,
          name: cookie.name,
          value: cookie.value,
        });
      }
      for (const [name, value] of headers) {
        if (name.toLowerCase() === 'set-cookie') {
          response.headers.append(name, value);
        } else {
          response.headers.set(name, value);
        }
      }
      return response;
    },
  };
}

export function createSupabaseCookieAdapter({
  getAll,
  set,
  setHeader,
}: SupabaseCookieAdapterSource): CookieMethodsServer {
  return {
    getAll: () => getAll().map(({ name, value }) => ({ name, value })),
    setAll: (cookies, headers) => {
      for (const cookie of cookies) {
        set(cookie.name, cookie.value, cookie.options);
      }
      for (const [name, value] of Object.entries(headers)) {
        setHeader(name, value);
      }
    },
  };
}
