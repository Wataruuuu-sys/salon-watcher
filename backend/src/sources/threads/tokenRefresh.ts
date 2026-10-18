import type { SecretStore } from '../../lib/secrets.js';
import { ThreadsAuthError } from './client.js';

const REFRESH_URL = 'https://graph.threads.net/refresh_access_token';

/** Extends the long-lived token (valid 60 days from refresh) and stores the new value. */
export async function refreshThreadsToken(secrets: SecretStore, http: typeof fetch): Promise<{ expiresInSec: number }> {
  const token = await secrets.get('THREADS_ACCESS_TOKEN');
  const params = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token });
  const res = await http(`${REFRESH_URL}?${params}`);
  if (!res.ok) {
    if (res.status === 401) throw new ThreadsAuthError('threads token refresh rejected (HTTP 401)');
    throw new Error(`threads token refresh failed: HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!body.access_token || typeof body.expires_in !== 'number') {
    throw new Error('threads token refresh: malformed response');
  }
  await secrets.put('THREADS_ACCESS_TOKEN', body.access_token);
  return { expiresInSec: body.expires_in };
}
