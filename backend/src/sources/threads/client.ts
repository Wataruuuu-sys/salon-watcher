export interface ThreadsPost {
  id: string;
  text: string;
  permalink: string;
  username: string;
  timestamp: string;
}

export interface ThreadsClient {
  keywordSearch(q: string): Promise<ThreadsPost[]>;
}

/** Token invalid/expired: not retryable, must surface to the owner. */
export class ThreadsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadsAuthError';
  }
}

const BASE = 'https://graph.threads.net/v1.0';
const OAUTH_ERROR_CODE = 190;

interface SearchResponse {
  data?: Partial<ThreadsPost>[];
  error?: { code?: number; message?: string };
}

export function threadsClient(token: string, http: typeof fetch): ThreadsClient {
  return {
    async keywordSearch(q) {
      const params = new URLSearchParams({
        q,
        search_type: 'RECENT',
        fields: 'id,text,permalink,username,timestamp',
        access_token: token,
      });
      const res = await http(`${BASE}/keyword_search?${params}`);
      const body = (await res.json().catch(() => ({}))) as SearchResponse;
      if (res.status === 401 || body.error?.code === OAUTH_ERROR_CODE) {
        throw new ThreadsAuthError(`threads auth failed (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`threads keyword_search failed: HTTP ${res.status}`);
      // Without an id (dedupe key) or permalink (lead URL) a post is unusable.
      return (body.data ?? []).filter((p) => p.id && p.permalink).map((p) => ({
        id: String(p.id),
        text: p.text ?? '',
        permalink: p.permalink!,
        username: p.username ?? '',
        timestamp: p.timestamp ?? '',
      }));
    },
  };
}
