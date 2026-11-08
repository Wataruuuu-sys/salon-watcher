export type Env = Record<string, string | undefined>;

/** Local development mode. Production leaves APP_ENV unset, so only the exact value 'local' enables it. */
export function isLocal(env: Env): boolean {
  return env.APP_ENV === 'local';
}

/** Fake external services are never enabled outside local mode, even if FAKE_EXTERNAL leaks into the env. */
export function fakesEnabled(env: Env): boolean {
  return isLocal(env) && env.FAKE_EXTERNAL === '1';
}
