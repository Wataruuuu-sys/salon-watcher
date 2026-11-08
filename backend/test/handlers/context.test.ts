import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/handlers/context.js';
import { testDbUrl } from '../helpers/db.js';

describe('buildContext (API Lambda)', () => {
  it('builds no classifier, so real mode needs no AWS region', async () => {
    const ctx = await buildContext({ APP_ENV: 'local', DATABASE_URL: testDbUrl });
    expect(ctx).not.toHaveProperty('llm');
    expect(ctx.secrets.kind).toBe('env');
  });
});
