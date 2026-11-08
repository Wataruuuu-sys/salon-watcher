import type { Logger } from '../lib/log.js';
import { type SendMail, sesSender } from '../notify/send.js';
import { type Env, isLocal } from './mode.js';

/** Mock mailer for local development: logs instead of sending. */
export function logMailer(log: Logger): SendMail {
  return async (subject, body) => {
    log.info('mail (mock)', { subject, body });
  };
}

export function mailerFor(env: Env, log: Logger): SendMail {
  if (isLocal(env)) return logMailer(log);
  const from = env.NOTIFY_FROM;
  const to = env.NOTIFY_TO;
  if (!from) throw new Error('NOTIFY_FROM is not set');
  if (!to) throw new Error('NOTIFY_TO is not set');
  return sesSender(from, to.split(',').map((s) => s.trim()));
}
