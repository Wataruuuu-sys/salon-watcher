import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { evidence, rawItems, settings, stores } from '../../src/db/schema.js';
import { handleApi, listLeads, type ApiEvent } from '../../src/handlers/api.js';

const db = await getTestDb();
const now = new Date('2026-10-18T00:00:00Z');

async function addStore(name: string, over: Partial<typeof stores.$inferInsert>, sources: ('threads' | 'google_maps')[] = ['threads'], signals: string[] = []) {
  const [s] = await db
    .insert(stores)
    .values({ name, nameNorm: name, confidence: 'yes', firstSeenAt: new Date('2026-10-17T00:00:00Z'), ...over })
    .returning();
  for (const [i, src] of sources.entries()) {
    const [r] = await db
      .insert(rawItems)
      .values({ source: src, externalId: `${name}-${i}`, url: `https://e.com/${name}/${i}`, text: 't', payload: {}, classification: { signals } })
      .returning();
    await db.insert(evidence).values({ storeId: s!.id, rawItemId: r!.id, source: src, url: `https://e.com/${name}/${i}`, confidence: s!.confidence, reason: `reason${i}` });
  }
  return s!;
}

async function seed() {
  await addStore('Y', { confidence: 'yes', firstSeenAt: new Date('2026-10-16T00:00:00Z') }, ['threads', 'google_maps']);
  await addStore('M', { confidence: 'map', genre: 'hair', city: '立川市' }, ['google_maps'], ['FUTURE_OPENING']);
  await addStore('Q', { confidence: 'maybe' });
  await addStore('L', { confidence: 'yes', hpbStatus: 'listed' });
}

beforeEach(() => resetDb(db));

describe('listLeads', () => {
  it('main tab returns yes+map, excludes listed, newest first, with evidence', async () => {
    await seed();
    const leads = await listLeads(db, { tab: 'main' }, now);
    expect(leads.map((l) => l.name)).toEqual(['M', 'Y']);
    const y = leads[1]!;
    expect(y.evidence).toHaveLength(2);
    expect(y.sources.sort()).toEqual(['google_maps', 'threads']);
    expect(leads[0]!.futureOpening).toBe(true);
    expect(y.futureOpening).toBe(false);
  });
  it('maybe tab returns only maybe', async () => {
    await seed();
    expect((await listLeads(db, { tab: 'maybe' }, now)).map((l) => l.name)).toEqual(['Q']);
  });
  it('hpb=all includes listed', async () => {
    await seed();
    expect((await listLeads(db, { tab: 'main', hpb: 'all' }, now)).map((l) => l.name).sort()).toEqual(['L', 'M', 'Y']);
  });
  it('filters by genre, city, source, days', async () => {
    await seed();
    expect((await listLeads(db, { tab: 'main', genre: 'hair' }, now)).map((l) => l.name)).toEqual(['M']);
    expect((await listLeads(db, { tab: 'main', city: '立川市' }, now)).map((l) => l.name)).toEqual(['M']);
    expect((await listLeads(db, { tab: 'main', source: 'threads' }, now)).map((l) => l.name)).toEqual(['Y']);
    expect((await listLeads(db, { tab: 'main', days: 1 }, now)).map((l) => l.name)).toEqual(['M']);
  });
});

function ev(
  routeKey: string,
  body?: unknown,
  qs?: Record<string, string>,
  claims: Record<string, unknown> = { username: 'owner-user', sub: 'sub-1' },
): ApiEvent {
  return {
    routeKey,
    queryStringParameters: qs,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims } } },
  } as unknown as ApiEvent;
}

describe('handleApi', () => {
  it('GET /leads parses query', async () => {
    await seed();
    const r = await handleApi(db, ev('GET /leads', undefined, { tab: 'maybe' }), now);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).leads).toHaveLength(1);
  });
  it('settings: 551 queries -> 400; PUT -> custom; DELETE -> default', async () => {
    const tooMany = Array.from({ length: 551 }, (_, i) => `q${i}`);
    const bad = await handleApi(db, ev('PUT /settings/threads-queries', { queries: tooMany }));
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).error).toBeTypeOf('string');

    const put = await handleApi(db, ev('PUT /settings/threads-queries', { queries: ['a', 'b'] }));
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual({ queries: ['a', 'b'], source: 'custom', perDay: 8, quota: 2200 });
    expect(JSON.parse((await handleApi(db, ev('GET /settings/threads-queries'))).body).source).toBe('custom');

    const del = await handleApi(db, ev('DELETE /settings/threads-queries'));
    expect(JSON.parse(del.body).source).toBe('default');
  });
  it('records updatedBy from the access token username, falling back to sub then unknown', async () => {
    const who = async (claims: Record<string, unknown>) => {
      await handleApi(db, ev('PUT /settings/threads-queries', { queries: ['a'] }, undefined, claims));
      const [row] = await db.select().from(settings);
      return row!.updatedBy;
    };
    expect(await who({ username: 'owner-user', sub: 'sub-1' })).toBe('owner-user');
    expect(await who({ sub: 'sub-1' })).toBe('sub-1');
    expect(await who({})).toBe('unknown');
  });
  it('400 on invalid JSON / bad shape, 404 on unknown route', async () => {
    expect((await handleApi(db, ev('PUT /settings/threads-queries', '{oops'))).statusCode).toBe(400);
    expect((await handleApi(db, ev('PUT /settings/threads-queries', { queries: 'x' }))).statusCode).toBe(400);
    expect((await handleApi(db, ev('GET /nope'))).statusCode).toBe(404);
  });
});
