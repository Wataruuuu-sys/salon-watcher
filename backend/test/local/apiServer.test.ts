import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { settings, stores } from '../../src/db/schema.js';
import { createApiServer } from '../../src/local/apiServer.js';

const db = await getTestDb();
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = createApiServer(db);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => resetDb(db));

describe('createApiServer', () => {
  it('GET /leads?tab=main returns leads', async () => {
    await db.insert(stores).values({ name: 'Y', nameNorm: 'y', confidence: 'yes', firstSeenAt: new Date() });
    const res = await fetch(`${base}/leads?tab=main`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leads: { name: string }[] };
    expect(body.leads.map((l) => l.name)).toEqual(['Y']);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('PUT /settings/threads-queries records updated_by local-dev', async () => {
    const res = await fetch(`${base}/settings/threads-queries`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: ['新規オープン 美容室'] }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedBy).toBe('local-dev');
  });

  it('unknown path is 404', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('answers CORS preflight', async () => {
    const res = await fetch(`${base}/leads`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});
