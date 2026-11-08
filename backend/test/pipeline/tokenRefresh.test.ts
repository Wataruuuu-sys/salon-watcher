import { describe, expect, it, vi } from 'vitest';
import { runTokenRefresh } from '../../src/pipeline/tokenRefresh.js';

function ctxWith(env: Record<string, string | undefined>) {
  const infos: string[] = [];
  const http = vi.fn(
    async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 100 }), { status: 200 }),
  ) as unknown as typeof fetch;
  const secrets = { get: vi.fn(async () => 'placeholder'), put: vi.fn(async () => {}) };
  const log = { info: (m: string) => void infos.push(m), warn() {}, error() {} };
  return { ctx: { env, http, secrets, log }, http, secrets, infos };
}

describe('runTokenRefresh', () => {
  it('skips without touching the token when threads is disabled', async () => {
    const { ctx, http, secrets, infos } = ctxWith({ SOURCES_DISABLED: 'threads' });
    expect(await runTokenRefresh(ctx)).toEqual({ skipped: true });
    expect(http).not.toHaveBeenCalled();
    expect(secrets.get).not.toHaveBeenCalled();
    expect(infos.join()).toMatch(/threads.*(disabled|skipped)/);
  });

  it('refreshes when threads is enabled', async () => {
    const { ctx, secrets } = ctxWith({});
    expect(await runTokenRefresh(ctx)).toEqual({ expiresInSec: 100 });
    expect(secrets.put).toHaveBeenCalledWith('THREADS_ACCESS_TOKEN', 'new');
  });
});
