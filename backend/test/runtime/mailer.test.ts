import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/lib/log.js';
import { logMailer, mailerFor } from '../../src/runtime/mailer.js';

function spyLog() {
  const info = vi.fn();
  const log: Logger = { info, warn: vi.fn(), error: vi.fn() };
  return { log, info };
}

describe('mailers', () => {
  it('logMailer logs subject and body', async () => {
    const { log, info } = spyLog();
    await logMailer(log)('件名', '本文');
    expect(info).toHaveBeenCalledWith('mail (mock)', { subject: '件名', body: '本文' });
  });
  it('local mailer logs and does not use SES', async () => {
    const { log, info } = spyLog();
    await mailerFor({ APP_ENV: 'local' }, log)('S', 'B');
    expect(info).toHaveBeenCalledWith('mail (mock)', { subject: 'S', body: 'B' });
  });
  it('production without NOTIFY_FROM/TO throws', () => {
    const { log } = spyLog();
    expect(() => mailerFor({}, log)).toThrow(/NOTIFY_FROM/);
    expect(() => mailerFor({ NOTIFY_FROM: 'a@x.invalid' }, log)).toThrow(/NOTIFY_TO/);
  });
  it('production with config builds a sender', () => {
    const { log } = spyLog();
    expect(typeof mailerFor({ NOTIFY_FROM: 'a@x.invalid', NOTIFY_TO: 'b@x.invalid,c@x.invalid' }, log)).toBe('function');
  });
});
