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
  it('falls back to "fake" for missing external API keys only when fakes are enabled', async () => {
    const s = secretStoreFor({ APP_ENV: 'local', FAKE_EXTERNAL: '1', ANTHROPIC_API_KEY: 'real' });
    expect(s.kind).toBe('env');
    expect(await s.get('PLACES_API_KEY')).toBe('fake');
    expect(await s.get('THREADS_ACCESS_TOKEN')).toBe('fake');
    expect(await s.get('ANTHROPIC_API_KEY')).toBe('real');
    await expect(s.get('DATABASE_URL')).rejects.toThrow('secret not found');
    await expect(secretStoreFor({ APP_ENV: 'local' }).get('PLACES_API_KEY')).rejects.toThrow('secret not found');
  });
  it('never fakes keys outside local mode, even with FAKE_EXTERNAL=1', () => {
    expect(secretStoreFor({ FAKE_EXTERNAL: '1' }).kind).toBe('ssm');
  });
  it('put writes to the env object only', async () => {
    const env: Record<string, string | undefined> = {};
    const s = envSecretStore(env);
    await s.put('K', 'v');
    expect(env.K).toBe('v');
    expect(await s.get('K')).toBe('v');
  });
});
