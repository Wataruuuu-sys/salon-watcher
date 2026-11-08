import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceId } from '../domain/types.js';
import { createLogger, type Logger } from '../lib/log.js';
import { runNotify } from '../pipeline/notify.js';
import { runTokenRefresh } from '../pipeline/tokenRefresh.js';
import type { Env } from '../runtime/mode.js';
import { type BatchContext, buildBatchContext } from './context.js';
import { type RunOptions, runPipeline } from './run.js';

const USAGE = `usage:
  batch run --sources <google_maps|threads>[,...]
  batch notify
  batch refresh-threads-token`;

const SOURCE_IDS: readonly SourceId[] = ['google_maps', 'threads'];
/** Safety cap on one invocation, so a run stuck on an external API stops costing money. */
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

type Command = { kind: 'run'; sources: SourceId[] } | { kind: 'notify' } | { kind: 'refresh-threads-token' };

function parse(argv: string[]): Command | null {
  const [cmd, ...rest] = argv;
  if (cmd === 'notify' && rest.length === 0) return { kind: 'notify' };
  if (cmd === 'refresh-threads-token' && rest.length === 0) return { kind: 'refresh-threads-token' };
  if (cmd === 'run' && rest.length === 2 && rest[0] === '--sources') {
    const sources = rest[1]!.split(',').map((s) => s.trim());
    if (sources.length > 0 && sources.every((s) => (SOURCE_IDS as string[]).includes(s))) {
      return { kind: 'run', sources: [...new Set(sources)] as SourceId[] };
    }
  }
  return null;
}

/** Returns true when the command succeeded. */
async function execute(ctx: BatchContext, cmd: Command, runOptions?: RunOptions): Promise<boolean> {
  switch (cmd.kind) {
    case 'run': {
      const r = await runPipeline(ctx, cmd.sources, runOptions);
      ctx.log.info('run done', { ...r });
      return r.ok;
    }
    case 'notify': {
      const r = await runNotify(ctx.db, ctx.mail, { uiUrl: ctx.env.UI_URL ?? '', now: ctx.now });
      ctx.log.info('notify done', r);
      return true;
    }
    case 'refresh-threads-token':
      await runTokenRefresh(ctx);
      return true;
  }
}

/**
 * Batch entrypoint; returns the process exit code: 0 ok, 1 failed (any shard/step, error or timeout),
 * 2 usage error.
 */
export async function main(
  argv: string[],
  env: Env,
  deps: { build?: typeof buildBatchContext; timeoutMs?: number; log?: Logger; runOptions?: RunOptions } = {},
): Promise<number> {
  const fallbackLog = deps.log ?? createLogger();
  const cmd = parse(argv);
  if (!cmd) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let ctx = undefined as BatchContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const work = (async () => {
    ctx = await (deps.build ?? buildBatchContext)(env);
    return execute(ctx, cmd, deps.runOptions);
  })();

  try {
    const outcome = await Promise.race([work, timedOut]);
    if (outcome === 'timeout') {
      (ctx?.log ?? fallbackLog).error('batch timed out', { argv, timeoutMs });
      work.catch(() => {}); // the abandoned work may still fail once the DB closes
      return 1;
    }
    return outcome ? 0 : 1;
  } catch (err) {
    (ctx?.log ?? fallbackLog).error('batch failed', { argv, error: String(err) });
    return 1;
  } finally {
    clearTimeout(timer);
    await ctx?.close().catch(() => {});
  }
}

/** True when this module is the process entrypoint (tsx src/batch/main.ts or node dist/batch/main.js). */
function isEntrypoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exit(await main(process.argv.slice(2), process.env));
}
