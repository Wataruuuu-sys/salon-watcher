import { type SecretStore, ssmSecretStore } from '../lib/secrets.js';
import { type Env, fakesEnabled, isLocal } from './mode.js';

/** Keys only the (faked) external clients use; DATABASE_URL is never faked. */
const FAKEABLE_KEYS = new Set(['PLACES_API_KEY', 'THREADS_ACCESS_TOKEN', 'ANTHROPIC_API_KEY']);

/** Secrets from environment variables; put() only mutates the given env object (in memory). */
export function envSecretStore(env: Env): SecretStore {
  return {
    kind: 'env',
    async get(name) {
      const value = env[name];
      if (value === undefined) throw new Error(`secret not found: ${name}`);
      return value;
    },
    async put(name, value) {
      env[name] = value;
    },
  };
}

/** With fake external services the API keys are unused, so missing ones read as 'fake'. */
function withFakeKeys(store: SecretStore): SecretStore {
  return {
    kind: store.kind,
    async get(name) {
      try {
        return await store.get(name);
      } catch (err) {
        if (FAKEABLE_KEYS.has(name)) return 'fake';
        throw err;
      }
    },
    put: (name, value) => store.put(name, value),
  };
}

export function secretStoreFor(env: Env): SecretStore {
  if (!isLocal(env)) return ssmSecretStore();
  const store = envSecretStore(env);
  return fakesEnabled(env) ? withFakeKeys(store) : store;
}
