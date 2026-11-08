import { type SecretStore, ssmSecretStore } from '../lib/secrets.js';
import { type Env, isLocal } from './mode.js';

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

export function secretStoreFor(env: Env): SecretStore {
  return isLocal(env) ? envSecretStore(env) : ssmSecretStore();
}
