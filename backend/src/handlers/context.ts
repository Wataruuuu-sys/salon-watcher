import { createDb } from '../db/client.js';
import { createLogger } from '../lib/log.js';
import type { Env } from '../runtime/mode.js';
import { secretStoreFor } from '../runtime/secrets.js';
import type { SourceContext } from '../sources/types.js';

/** The API Lambda never classifies, so it builds no LLM client (the batch adds one, see batch/context.ts). */
export type HandlerContext = SourceContext;

let cached: Promise<Omit<HandlerContext, 'now'>> | undefined;

/** Reads secrets once per Lambda container (SSM, or env when local); the DB connection is reused while warm. */
export function buildContext(env: Env = process.env): Promise<HandlerContext> {
  cached ??= (async () => {
    const secrets = secretStoreFor(env);
    const databaseUrl = await secrets.get('DATABASE_URL');
    return {
      db: createDb(databaseUrl),
      http: fetch,
      secrets,
      log: createLogger(),
    };
  })();
  cached.catch(() => {
    cached = undefined; // do not cache a failed cold start
  });
  return cached.then((c) => ({ ...c, now: new Date() }));
}
