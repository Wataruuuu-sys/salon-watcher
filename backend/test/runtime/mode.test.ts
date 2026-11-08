import { describe, expect, it } from 'vitest';
import { fakesEnabled, isLocal } from '../../src/runtime/mode.js';

describe('mode', () => {
  it('isLocal only for APP_ENV=local', () => {
    expect(isLocal({ APP_ENV: 'local' })).toBe(true);
    expect(isLocal({})).toBe(false);
    expect(isLocal({ APP_ENV: 'LOCAL' })).toBe(false);
  });
  it('fakesEnabled requires local', () => {
    expect(fakesEnabled({ FAKE_EXTERNAL: '1' })).toBe(false);
    expect(fakesEnabled({ APP_ENV: 'local', FAKE_EXTERNAL: '1' })).toBe(true);
    expect(fakesEnabled({ APP_ENV: 'local' })).toBe(false);
  });
});
