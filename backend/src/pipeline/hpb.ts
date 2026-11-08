import { checkPendingStores } from '../hpb/check.js';
import type { HandlerContext } from '../handlers/context.js';

/** Raised from Phase 1's 40 (sized for a Lambda run); the batch has no 15-minute limit. */
export const HPB_LIMIT = 300;

export async function runHpb(
  ctx: Pick<HandlerContext, 'db' | 'log'> & { hpbHttp: typeof fetch },
  limit = HPB_LIMIT,
  sleep?: (ms: number) => Promise<void>,
): Promise<number> {
  const checked = await checkPendingStores(ctx.db, ctx.hpbHttp, limit, sleep);
  ctx.log.info('hpb checked', { checked });
  return checked;
}
