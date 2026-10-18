import type { Db } from '../db/client.js';
import type { RawItemInput, SourceId } from '../domain/types.js';
import type { Logger } from '../lib/log.js';
import type { SecretStore } from '../lib/secrets.js';

export type { SecretStore } from '../lib/secrets.js';

export interface SourceContext {
  db: Db;
  http: typeof fetch;
  secrets: SecretStore;
  now: Date;
  log: Logger;
}

export interface Source {
  id: SourceId;
  /** Unit of fan-out for the Step Functions Map state. */
  listShards(ctx: SourceContext): Promise<string[]>;
  collect(shard: string, ctx: SourceContext): Promise<RawItemInput[]>;
}
