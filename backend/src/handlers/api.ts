import { and, desc, eq, gte, inArray, ne, type SQL } from 'drizzle-orm';
import { THREADS_DAILY_QUOTA, THREADS_RUNS_PER_DAY } from '../config/threadsQueries.js';
import type { Db } from '../db/client.js';
import { evidence, rawItems, stores } from '../db/schema.js';
import type { Confidence, Genre, HpbStatus, SourceId } from '../domain/types.js';
import { loadThreadsQueries, resetThreadsQueries, saveThreadsQueries } from '../sources/threads/queries.js';
import { buildContext } from './context.js';

export interface LeadQuery {
  tab: 'main' | 'maybe';
  genre?: string;
  city?: string;
  source?: string;
  /** Omitted: listed stores are hidden. 'all': include them. Otherwise an exact status. */
  hpb?: string;
  days?: number;
}

export interface Lead {
  id: number;
  name: string;
  genre: Genre | null;
  city: string | null;
  confidence: Confidence;
  sources: SourceId[];
  evidence: { source: SourceId; url: string; reason: string }[];
  openingDate: string | null;
  hpbStatus: HpbStatus;
  hpbUrl: string | null;
  firstSeenAt: string;
  /** True when any evidence carries the Google Maps FUTURE_OPENING sign. */
  futureOpening: boolean;
}

const DEFAULT_DAYS = 7;
const DAY_MS = 86_400_000;

export async function listLeads(db: Db, q: LeadQuery, now: Date = new Date()): Promise<Lead[]> {
  const days = q.days ?? DEFAULT_DAYS;
  const conds: SQL[] = [
    q.tab === 'maybe' ? eq(stores.confidence, 'maybe') : inArray(stores.confidence, ['yes', 'map']),
    gte(stores.firstSeenAt, new Date(now.getTime() - days * DAY_MS)),
  ];
  if (q.genre) conds.push(eq(stores.genre, q.genre));
  if (q.city) conds.push(eq(stores.city, q.city));
  if (q.hpb === undefined || q.hpb === '') conds.push(ne(stores.hpbStatus, 'listed'));
  else if (q.hpb !== 'all') conds.push(eq(stores.hpbStatus, q.hpb));

  const rows = await db
    .select()
    .from(stores)
    .where(and(...conds))
    .orderBy(desc(stores.firstSeenAt), desc(stores.id));
  if (rows.length === 0) return [];

  const ev = await db
    .select({
      storeId: evidence.storeId,
      source: evidence.source,
      url: evidence.url,
      reason: evidence.reason,
      classification: rawItems.classification,
    })
    .from(evidence)
    .innerJoin(rawItems, eq(rawItems.id, evidence.rawItemId))
    .where(inArray(evidence.storeId, rows.map((s) => s.id)))
    .orderBy(evidence.id);

  const leads = rows.map((s): Lead => {
    const mine = ev.filter((e) => e.storeId === s.id);
    return {
      id: s.id,
      name: s.name,
      genre: s.genre as Genre | null,
      city: s.city,
      confidence: s.confidence as Confidence,
      sources: [...new Set(mine.map((e) => e.source as SourceId))],
      evidence: mine.map((e) => ({ source: e.source as SourceId, url: e.url, reason: e.reason })),
      openingDate: s.openingDate,
      hpbStatus: s.hpbStatus as HpbStatus,
      hpbUrl: s.hpbUrl,
      firstSeenAt: s.firstSeenAt.toISOString(),
      futureOpening: mine.some((e) => {
        const sig = (e.classification as { signals?: unknown } | null)?.signals;
        return Array.isArray(sig) && sig.includes('FUTURE_OPENING');
      }),
    };
  });
  return q.source ? leads.filter((l) => l.sources.includes(q.source as SourceId)) : leads;
}

export interface ThreadsQueriesView {
  queries: string[];
  source: 'default' | 'custom';
  perDay: number;
  quota: number;
}

export async function getThreadsQueriesView(db: Db): Promise<ThreadsQueriesView> {
  const { queries, source } = await loadThreadsQueries(db);
  return { queries, source, perDay: queries.length * THREADS_RUNS_PER_DAY, quota: THREADS_DAILY_QUOTA };
}

/** Minimal API Gateway HTTP API (payload v2) event shape used here. */
export interface ApiEvent {
  routeKey: string;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}
export interface ApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const json = (statusCode: number, data: unknown): ApiResult => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(data),
});

function parseBody(event: ApiEvent): { ok: true; value: unknown } | { ok: false } {
  if (!event.body) return { ok: false };
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** The web client sends a Cognito access token, which carries `username` (and `sub`) but no `email`. */
function updatedBy(event: ApiEvent): string {
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  for (const key of ['username', 'sub']) {
    const v = claims[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return 'unknown';
}

export async function handleApi(db: Db, event: ApiEvent, now: Date = new Date()): Promise<ApiResult> {
  switch (event.routeKey) {
    case 'GET /leads': {
      const p = event.queryStringParameters ?? {};
      const days = p.days !== undefined && p.days !== '' ? Number(p.days) : undefined;
      if (days !== undefined && (!Number.isFinite(days) || days <= 0)) return json(400, { error: 'days が不正です' });
      const leads = await listLeads(
        db,
        { tab: p.tab === 'maybe' ? 'maybe' : 'main', genre: p.genre, city: p.city, source: p.source, hpb: p.hpb, days },
        now,
      );
      return json(200, { leads });
    }
    case 'GET /settings/threads-queries':
      return json(200, await getThreadsQueriesView(db));
    case 'PUT /settings/threads-queries': {
      const body = parseBody(event);
      if (!body.ok) return json(400, { error: 'JSONを解釈できません' });
      const queries = (body.value as { queries?: unknown } | null)?.queries;
      if (!Array.isArray(queries) || !queries.every((q) => typeof q === 'string')) {
        return json(400, { error: 'queries は文字列の配列にしてください' });
      }
      const result = await saveThreadsQueries(db, queries, updatedBy(event));
      if (!result.ok) return json(400, { error: result.error });
      return json(200, await getThreadsQueriesView(db));
    }
    case 'DELETE /settings/threads-queries':
      await resetThreadsQueries(db);
      return json(200, await getThreadsQueriesView(db));
    default:
      return json(404, { error: 'not found' });
  }
}

export async function handler(event: ApiEvent): Promise<ApiResult> {
  const ctx = await buildContext();
  return handleApi(ctx.db, event, ctx.now);
}
