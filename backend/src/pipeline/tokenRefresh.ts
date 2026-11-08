import { fakesEnabled, type Env } from '../runtime/mode.js';
import type { SourceContext } from '../sources/types.js';
import { refreshThreadsToken } from '../sources/threads/tokenRefresh.js';

/** Weekly token refresh. Errors propagate so the batch exits non-zero (alarm). Skipped on fakes. */
export async function runTokenRefresh(
  ctx: Pick<SourceContext, 'secrets' | 'http' | 'log'> & { env: Env },
): Promise<{ expiresInSec: number } | { skipped: true }> {
  if (fakesEnabled(ctx.env)) {
    ctx.log.info('threads token refresh skipped (fake external services)');
    return { skipped: true };
  }
  const result = await refreshThreadsToken(ctx.secrets, ctx.http);
  ctx.log.info('threads token refreshed', result);
  return result;
}
