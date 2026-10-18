import { anthropicClassifier } from '../classify/llm.js';
import type { LlmClassifier } from '../classify/classify.js';
import { createDb } from '../db/client.js';
import { createLogger } from '../lib/log.js';
import { ssmSecretStore } from '../lib/secrets.js';
import type { SourceContext } from '../sources/types.js';

export type HandlerContext = SourceContext & { llm: LlmClassifier };

let cached: Promise<Omit<HandlerContext, 'now'>> | undefined;

/** Reads secrets from SSM once per Lambda container; the DB connection is reused while warm. */
export function buildContext(): Promise<HandlerContext> {
  cached ??= (async () => {
    const secrets = ssmSecretStore();
    const [databaseUrl, apiKey] = await Promise.all([secrets.get('DATABASE_URL'), secrets.get('ANTHROPIC_API_KEY')]);
    return {
      db: createDb(databaseUrl),
      http: fetch,
      secrets,
      log: createLogger(),
      llm: anthropicClassifier(apiKey),
    };
  })();
  cached.catch(() => {
    cached = undefined; // do not cache a failed cold start
  });
  return cached.then((c) => ({ ...c, now: new Date() }));
}

/**
 * Context for steps that need no secrets or DB (listing shards): avoids SSM round trips.
 * Touching `db` here is a programming error.
 */
export function lightContext(): SourceContext {
  return {
    get db(): never {
      throw new Error('db is not available in a light context');
    },
    http: fetch,
    secrets: ssmSecretStore(),
    now: new Date(),
    log: createLogger(),
  };
}
