import { getAccessToken } from './auth';
import type { Lead, ThreadsQueriesView } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, 'ログインが必要です');
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `エラー (${res.status})`);
  return data;
}

export interface LeadFilters {
  tab: 'main' | 'maybe';
  genre: string;
  city: string;
  source: string;
  hpb: string;
  days: string;
}

export async function fetchLeads(f: LeadFilters): Promise<Lead[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  return (await request<{ leads: Lead[] }>(`/leads?${params}`)).leads;
}

export const fetchThreadsQueries = () => request<ThreadsQueriesView>('/settings/threads-queries');
export const saveThreadsQueries = (queries: string[]) =>
  request<ThreadsQueriesView>('/settings/threads-queries', { method: 'PUT', body: JSON.stringify({ queries }) });
export const resetThreadsQueries = () =>
  request<ThreadsQueriesView>('/settings/threads-queries', { method: 'DELETE' });
