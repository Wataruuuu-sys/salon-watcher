import { realpathSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '../db/client.js';
import { handleApi, type ApiEvent } from '../handlers/api.js';
import { isLocal } from '../runtime/mode.js';

const ALLOWED_ORIGIN = 'http://localhost:3000';
const CORS = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Local stand-in for API Gateway + Lambda: maps HTTP onto handleApi with a fixed dev identity (no auth). */
export function createApiServer(db: Db): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS).end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const body = await readBody(req);
      const event: ApiEvent = {
        routeKey: `${req.method} ${url.pathname}`,
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: body || null,
        requestContext: { authorizer: { jwt: { claims: { username: 'local-dev' } } } },
      };
      const result = await handleApi(db, event);
      res.writeHead(result.statusCode, { ...CORS, 'content-type': 'application/json' }).end(result.body);
    } catch (err) {
      console.error('api error', err);
      res.writeHead(500, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal error' }));
    }
  });
}

/** True when this module is the process entrypoint (tsx src/local/apiServer.ts). */
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
  if (!isLocal(process.env)) {
    console.error('refusing to start: the local API server requires APP_ENV=local');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8080);
  createApiServer(createDb(url)).listen(port, () => console.log(`local api listening on :${port}`));
}
