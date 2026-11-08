import type { ThreadsClient, ThreadsPost } from '../sources/threads/client.js';

export const FAKE_THREADS_POSTS: ThreadsPost[] = [
  {
    id: 'fake-threads-lily',
    text: '11/1 立川駅北口に Nail Salon Lily 立川店 OPEN',
    permalink: 'https://www.threads.net/@lily_nail/post/fake-threads-lily',
    username: 'lily_nail',
    timestamp: '2026-10-20T03:00:00+0000',
  },
  {
    id: 'fake-threads-unknown',
    text: '来月新店オープンします！',
    permalink: 'https://www.threads.net/@unknown_shop/post/fake-threads-unknown',
    username: 'unknown_shop',
    timestamp: '2026-10-21T03:00:00+0000',
  },
];

/** Returns the same two posts for every keyword; the source dedupes by id. */
export function fakeThreadsClient(): ThreadsClient {
  return { keywordSearch: async () => FAKE_THREADS_POSTS };
}
