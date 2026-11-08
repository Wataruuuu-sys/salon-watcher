import type { LlmClassifier } from '../classify/classify.js';
import { createDb } from '../db/client.js';
import { createLogger } from '../lib/log.js';
import { externalDepsFor } from '../runtime/external.js';
import type { Env } from '../runtime/mode.js';
import { secretStoreFor } from '../runtime/secrets.js';
import type { SourceContext } from '../sources/types.js';

export type HandlerContext = SourceContext & { llm: LlmClassifier };

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
      llm: externalDepsFor(env).llm(),
    };
  })();
  cached.catch(() => {
    cached = undefined; // do not cache a failed cold start
  });
  return cached.then((c) => ({ ...c, now: new Date() }));
}
