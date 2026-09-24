import type { MediaJob, MediaJobSpec } from './mediaJob';

export type MediaJobApiClient = {
  create(spec: MediaJobSpec): Promise<MediaJob>;
  get(id: string): Promise<MediaJob>;
  cancel(id: string): Promise<MediaJob>;
  events(id: string, onJob: (job: MediaJob) => void): EventSource;
};

function baseUrl(): string {
  const configured =
    typeof window !== 'undefined' ? (window as Window & { __mediaServicePort?: number }).__mediaServicePort : undefined;
  return `http://127.0.0.1:${configured ?? 33002}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${url}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `MEDIA_SERVICE_HTTP_${response.status}`);
  return payload;
}

export const mediaJobApi: MediaJobApiClient = {
  create: (spec) => request<MediaJob>('/api/media-jobs', { method: 'POST', body: JSON.stringify(spec) }),
  get: (id) => request<MediaJob>(`/api/media-jobs/${encodeURIComponent(id)}`),
  cancel: (id) => request<MediaJob>(`/api/media-jobs/${encodeURIComponent(id)}?action=cancel`, { method: 'POST' }),
  events: (id, onJob) => {
    const source = new EventSource(`${baseUrl()}/api/media-jobs/${encodeURIComponent(id)}/events`);
    source.addEventListener('progress', (event) => onJob(JSON.parse((event as MessageEvent).data) as MediaJob));
    return source;
  },
};
