import { checkPendingStores } from '../hpb/check.js';
import { buildContext } from './context.js';

export async function hpbHandler(): Promise<{ checked: number }> {
  const ctx = await buildContext();
  const checked = await checkPendingStores(ctx.db, ctx.http);
  ctx.log.info('hpb checked', { checked });
  return { checked };
}
