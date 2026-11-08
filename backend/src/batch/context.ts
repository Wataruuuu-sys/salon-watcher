import type { LlmClassifier } from '../classify/classify.js';
import { createDb, closeDb } from '../db/client.js';
import type { SourceId } from '../domain/types.js';
import type { HandlerContext } from '../handlers/context.js';
import { createLogger } from '../lib/log.js';
import type { SendMail } from '../notify/send.js';
import { externalDepsFor } from '../runtime/external.js';
import { mailerFor } from '../runtime/mailer.js';
import type { Env } from '../runtime/mode.js';
import { secretStoreFor } from '../runtime/secrets.js';
import { buildRegistry } from '../sources/registry.js';
import type { Source } from '../sources/types.js';

export interface BatchContext extends HandlerContext {
  llm: LlmClassifier;
  getSource(id: SourceId): Source;
  hpbHttp: typeof fetch;
  mail: SendMail;
  env: Env;
  /** Releases the DB connection; the batch calls it once before exiting. */
  close(): Promise<void>;
}

/**
 * One context per batch invocation. Secrets come from SSM (env when local; with fakes, missing API keys
 * read as 'fake'). The mailer is resolved on first send so `run` does not need the NOTIFY_* settings.
 */
export async function buildBatchContext(env: Env): Promise<BatchContext> {
  const log = createLogger();
  const secrets = secretStoreFor(env);
  const external = externalDepsFor(env);
  const databaseUrl = await secrets.get('DATABASE_URL');
  const db = createDb(databaseUrl);
  return {
    db,
    http: fetch,
    secrets,
    now: new Date(),
    log,
    llm: external.llm(),
    getSource: buildRegistry(external.sources).getSource,
    hpbHttp: external.hpbHttp,
    mail: (subject, body) => mailerFor(env, log)(subject, body),
    env,
    close: () => closeDb(db),
  };
}
