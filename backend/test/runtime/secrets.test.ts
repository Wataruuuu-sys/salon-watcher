import { describe, expect, it } from 'vitest';
import { envSecretStore, secretStoreFor } from '../../src/runtime/secrets.js';

describe('secretStoreFor', () => {
  it('uses SSM unless local', () => {
    expect(secretStoreFor({}).kind).toBe('ssm');
    expect(secretStoreFor({ APP_ENV: 'prod' }).kind).toBe('ssm');
  });
  it('uses env in local', async () => {
    const s = secretStoreFor({ APP_ENV: 'local', DATABASE_URL: 'postgres://x' });
    expect(s.kind).toBe('env');
    expect(await s.get('DATABASE_URL')).toBe('postgres://x');
    await expect(s.get('MISSING')).rejects.toThrow('secret not found');
  });
  it('put writes to the env object only', async () => {
    const env: Record<string, string | undefined> = {};
    const s = envSecretStore(env);
    await s.put('K', 'v');
    expect(env.K).toBe('v');
    expect(await s.get('K')).toBe('v');
  });
});
