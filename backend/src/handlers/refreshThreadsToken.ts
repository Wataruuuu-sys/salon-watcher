import { ssmSecretStore } from '../lib/secrets.js';
import { refreshThreadsToken } from '../sources/threads/tokenRefresh.js';

/** Weekly token refresh. Errors propagate so the CloudWatch Errors alarm fires. */
export async function refreshThreadsTokenHandler(): Promise<{ expiresInSec: number }> {
  return refreshThreadsToken(ssmSecretStore(), fetch);
}
