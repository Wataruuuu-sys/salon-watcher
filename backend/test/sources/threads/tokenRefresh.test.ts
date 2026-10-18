import { describe, expect, it } from 'vitest';
import { refreshThreadsToken } from '../../../src/sources/threads/tokenRefresh.js';

function fakeSecrets() {
  const puts: [string, string][] = [];
  return { puts, store: { get: async () => 'OLD', put: async (n: string, v: string) => { puts.push([n, v]); } } };
}

describe('refreshThreadsToken', () => {
  it('stores the new token and returns expiry', async () => {
    const { puts, store } = fakeSecrets();
    let url = '';
    const http = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ access_token: 'NEW', token_type: 'bearer', expires_in: 5183944 }));
    }) as unknown as typeof fetch;
    const res = await refreshThreadsToken(store, http);
    expect(res).toEqual({ expiresInSec: 5183944 });
    expect(puts).toEqual([['THREADS_ACCESS_TOKEN', 'NEW']]);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://graph.threads.net/refresh_access_token');
    expect(u.searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(u.searchParams.get('access_token')).toBe('OLD');
  });

  it('throws on HTTP 400 without writing', async () => {
    const { puts, store } = fakeSecrets();
    const http = (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch;
    await expect(refreshThreadsToken(store, http)).rejects.toThrow();
    expect(puts).toEqual([]);
  });

  it('throws on a malformed success body without writing', async () => {
    const { puts, store } = fakeSecrets();
    const http = (async () => new Response('{}')) as unknown as typeof fetch;
    await expect(refreshThreadsToken(store, http)).rejects.toThrow();
    expect(puts).toEqual([]);
  });
});
