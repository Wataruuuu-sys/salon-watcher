import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('authBypassed', () => {
  it('is false in production even when AUTH_MODE=none', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'none');
    const { authBypassed } = await import('../src/lib/auth');
    expect(authBypassed()).toBe(false);
  });
  it('is true in development with AUTH_MODE=none', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'none');
    const { authBypassed } = await import('../src/lib/auth');
    expect(authBypassed()).toBe(true);
  });
  it('is false in development without AUTH_MODE', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', '');
    const { authBypassed } = await import('../src/lib/auth');
    expect(authBypassed()).toBe(false);
  });
});

describe('api request when bypassed', () => {
  it('sends no Authorization header', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'none');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ leads: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLeads } = await import('../src/lib/api');
    await fetchLeads({ tab: 'main', genre: '', city: '', source: '', hpb: '', days: '' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});
