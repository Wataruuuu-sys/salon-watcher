export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** JSON-lines logger writing to stdout (CloudWatch-friendly). */
export function createLogger(): Logger {
  const emit = (level: string) => (msg: string, data?: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify({ level, msg, ...data, ts: new Date().toISOString() })}\n`);
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
