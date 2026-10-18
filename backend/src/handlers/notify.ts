import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { GENRES } from '../config/genres.js';
import type { Db } from '../db/client.js';
import { evidence, rawItems, stores } from '../db/schema.js';
import type { Confidence } from '../domain/types.js';
import { composeDigest, type LeadForMail } from '../notify/compose.js';
import { sesSender } from '../notify/send.js';
import { buildContext } from './context.js';

export async function runNotify(
  db: Db,
  send: (subject: string, body: string) => Promise<void>,
  opts: { uiUrl: string; now: Date },
): Promise<{ sent: boolean; main: number; maybe: number }> {
  const targets = await db
    .select()
    .from(stores)
    .where(and(isNull(stores.notifiedAt), ne(stores.hpbStatus, 'listed')))
    .orderBy(asc(stores.firstSeenAt), asc(stores.id));
  const main = targets.filter((s) => s.confidence === 'yes' || s.confidence === 'map');
  const maybeCount = targets.filter((s) => s.confidence === 'maybe').length;

  const ev = main.length
    ? await db
        .select({ storeId: evidence.storeId, url: evidence.url, classification: rawItems.classification })
        .from(evidence)
        .innerJoin(rawItems, eq(rawItems.id, evidence.rawItemId))
        .where(inArray(evidence.storeId, main.map((s) => s.id)))
        .orderBy(asc(evidence.id))
    : [];

  const leads: LeadForMail[] = main.map((s) => {
    const rows = ev.filter((e) => e.storeId === s.id);
    const signals = new Set<string>();
    for (const r of rows) {
      const sig = (r.classification as { signals?: unknown } | null)?.signals;
      if (Array.isArray(sig)) for (const x of sig) if (typeof x === 'string') signals.add(x);
    }
    return {
      name: s.name,
      genreLabel: GENRES.find((g) => g.id === s.genre)?.label ?? 'ジャンル不明',
      city: s.city,
      confidence: s.confidence as Confidence,
      openingDate: s.openingDate,
      evidenceUrls: [...new Set(rows.map((r) => r.url))],
      signals: [...signals],
    };
  });

  const digest = composeDigest(leads, maybeCount, opts.uiUrl);
  if (digest) await send(digest.subject, digest.body);
  // Only after a successful send; listed stores are never mailed but are marked too.
  if (targets.length > 0) {
    await db
      .update(stores)
      .set({ notifiedAt: opts.now })
      .where(inArray(stores.id, targets.map((s) => s.id)));
  }
  await db
    .update(stores)
    .set({ notifiedAt: opts.now })
    .where(and(isNull(stores.notifiedAt), eq(stores.hpbStatus, 'listed')));
  return { sent: digest !== null, main: main.length, maybe: maybeCount };
}

export async function notifyHandler(): Promise<{ sent: boolean; main: number; maybe: number }> {
  const ctx = await buildContext();
  const from = process.env.NOTIFY_FROM;
  const to = (process.env.NOTIFY_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const uiUrl = process.env.UI_URL ?? '';
  if (!from || to.length === 0) throw new Error('NOTIFY_FROM and NOTIFY_TO must be set');
  const result = await runNotify(ctx.db, sesSender(from, to), { uiUrl, now: ctx.now });
  ctx.log.info('notify done', result);
  return result;
}
